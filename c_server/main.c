#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>
#include <sys/uio.h>
#include <time.h>
#include "protocol.h"
#include "websocket_handshake.h"
#include "websocket_frame.h"

// connection states
typedef enum {
    STATE_TCP_CONNECTED,
    STATE_WS_ACTIVE
} ConnectionState;

// Statically pre-allocated memory pool to eliminate dynamic allocation overhead
Player all_players[MAX_CLIENTS];

typedef struct {
    int fd;
    int32_t player_id;
    int is_active;
    ConnectionState state;
} ClientConnection;

ClientConnection clients[MAX_CLIENTS];

// Global room for the game state
Room global_room;

void save_world_state() {
    FILE* file = fopen("world.bin", "wb");
    if (file) {
        fwrite(&global_room.hole_count, sizeof(int), 1, file);
        fwrite(&global_room.hole_index, sizeof(int), 1, file);
        fwrite(global_room.holes, sizeof(HoleStruct), MAX_HOLES, file);
        fclose(file);
    }
}

void load_world_state() {
    FILE* file = fopen("world.bin", "rb");
    if (file) {
        fread(&global_room.hole_count, sizeof(int), 1, file);
        fread(&global_room.hole_index, sizeof(int), 1, file);
        fread(global_room.holes, sizeof(HoleStruct), MAX_HOLES, file);
        fclose(file);
    }
}

void send_ws_binary_frame(int fd, const void* data, size_t len) {
    uint8_t header[10];
    size_t header_len = 0;

    header[0] = 0x82; // FIN (0x80) | Binary (0x02)

    if (len <= 125) {
        header[1] = len;
        header_len = 2;
    } else if (len <= 65535) {
        header[1] = 126;
        header[2] = (len >> 8) & 0xFF;
        header[3] = len & 0xFF;
        header_len = 4;
    } else {
        header[1] = 127;
        uint64_t len64 = (uint64_t)len;
        for (int i = 0; i < 8; i++) {
            header[2 + i] = (len64 >> ((7 - i) * 8)) & 0xFF;
        }
        header_len = 10;
    }

    struct iovec iov[2];
    iov[0].iov_base = header;
    iov[0].iov_len = header_len;
    iov[1].iov_base = (void*)data;
    iov[1].iov_len = len;
    
    writev(fd, iov, 2);
}

// Setup non-blocking socket
int set_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

void init_memory_pool() {
    memset(all_players, 0, sizeof(all_players));
    memset(clients, 0, sizeof(clients));
    memset(&global_room, 0, sizeof(global_room));
    
    for (int i = 0; i < MAX_CLIENTS; i++) {
        clients[i].fd = -1;
        clients[i].is_active = 0;
        // Pre-assign simple IDs for demonstration
        all_players[i].id = i + 1;
    }
}

void add_player_to_room(Room* room, Player* player) {
    if (room->player_count < MAX_ROOM_PLAYERS) {
        room->players[room->player_count++] = player;
    }
}

void remove_player_from_room(Room* room, Player* player) {
    for (int i = 0; i < room->player_count; i++) {
        if (room->players[i] == player) {
            room->players[i] = room->players[room->player_count - 1];
            room->player_count--;
            break;
        }
    }
}

void broadcast_type_105(Room* room, Player* sender) {
    uint8_t buffer[2048];
    buffer[0] = 105; // type
    
    int sender_zone = sender->zone_y;
    int payload_count = 0;
    int offset = 2;
    
    // Pack all active room players into the type 105 message
    for (int i = 0; i < room->player_count; i++) {
        Player* p = room->players[i];
        
        // As per the requirement: [uint32 numericId, float x, float y, float z]
        uint32_t numeric_id = p->id;
        memcpy(buffer + offset, &numeric_id, 4);
        memcpy(buffer + offset + 4, &p->x, 4);
        memcpy(buffer + offset + 8, &p->y, 4);
        memcpy(buffer + offset + 12, &p->z, 4);
        
        offset += 16;
        payload_count++;
    }
    buffer[1] = (uint8_t)payload_count;
    int payload_size = offset;

    // Send exclusively to clients satisfying abs(sender.zoneY - receiver.zoneY) <= 1
    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (clients[i].is_active && clients[i].state == STATE_WS_ACTIVE) {
            Player* p = &all_players[i];
            if (abs(p->zone_y - sender_zone) <= 1) {
                send_ws_binary_frame(clients[i].fd, buffer, payload_size);
            }
        }
    }
}

void handle_dig_event(Room* room, Player* sender, HoleStruct* hole) {
    // 1. Evict stale elements using FIFO buffer index logic
    room->holes[room->hole_index] = *hole;
    room->hole_index = (room->hole_index + 1) % MAX_HOLES;
    if (room->hole_count < MAX_HOLES) {
        room->hole_count++;
    }

    int hole_zone = (int)(hole->y / ZONE_SIZE);

    // 2. Broadcast to valid spatial zone exclusively
    // Define an informal binary scheme for "new_hole"
    uint8_t buffer[32];
    buffer[0] = 106; // Assume type 106 mapped to client 'dig' broadcast
    memcpy(buffer + 1, hole, sizeof(HoleStruct));
    int payload_size = 1 + sizeof(HoleStruct);

    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (clients[i].is_active && clients[i].state == STATE_WS_ACTIVE) {
            Player* p = &all_players[i];
            // Check receiver is in or adjacent to the hole's spatial zone
            if (abs(p->zone_y - hole_zone) <= 1) {
                send_ws_binary_frame(clients[i].fd, buffer, payload_size);
            }
        }
    }
}

int handle_client_message(ClientConnection* client, uint8_t* buffer, ssize_t bytes_read) {
    if (bytes_read <= 0) return -1;
    
    uint8_t packet_type = buffer[0];
    int idx = client - clients;
    Player* p = &all_players[idx];

    if (packet_type == 104) { // Move Message
        if (bytes_read == sizeof(MovePacketType104)) {
            MovePacketType104* move_msg = (MovePacketType104*)buffer;
            
            p->x = move_msg->x;
            p->y = move_msg->y;
            p->z = move_msg->z;
            p->zone_y = (int)(p->y / ZONE_SIZE);
            
            // Trigger Spatial Partitioning logic on broadcast
            broadcast_type_105(&global_room, p);
            
            return 0;
        }
    } else if (packet_type == 106) { // Dig/Hole message
        // [Type(1), x(4), y(4), z(4), r(4)]
        if (bytes_read == 1 + sizeof(HoleStruct)) {
            HoleStruct* hole = (HoleStruct*)(buffer + 1);
            handle_dig_event(&global_room, p, hole);
            return 0;
        }
    }

    return 0;
}

int main() {
    init_memory_pool();
    load_world_state();

    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        return 1;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    set_nonblocking(server_fd);

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(SERVER_PORT);

    if (bind(server_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        perror("bind");
        return 1;
    }

    if (listen(server_fd, MAX_CLIENTS) < 0) {
        perror("listen");
        return 1;
    }

    printf("Server listening on port %d\n", SERVER_PORT);

    struct pollfd fds[MAX_CLIENTS + 1];
    fds[0].fd = server_fd;
    fds[0].events = POLLIN;
    
    for (int i = 1; i <= MAX_CLIENTS; i++) {
        fds[i].fd = -1;
        fds[i].events = POLLIN;
    }

    time_t last_save_time = time(NULL);
    int last_hole_count = global_room.hole_count;

    while (1) {
        int poll_count = poll(fds, MAX_CLIENTS + 1, 1000);
        if (poll_count < 0) {
            perror("poll");
            break;
        }

        time_t current_time = time(NULL);
        if (current_time - last_save_time >= 30) {
            if (global_room.hole_count != last_hole_count) {
                save_world_state();
                last_hole_count = global_room.hole_count;
                printf("World state saved to world.bin\n");
            }
            last_save_time = current_time;
        }

        // Handle new connections
        if (fds[0].revents & POLLIN) {
            struct sockaddr_in client_addr;
            socklen_t client_len = sizeof(client_addr);
            int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_len);
            
            if (client_fd >= 0) {
                set_nonblocking(client_fd);
                
                int added = 0;
                for (int i = 0; i < MAX_CLIENTS; i++) {
                    if (!clients[i].is_active) {
                        clients[i].fd = client_fd;
                        clients[i].is_active = 1;
                        clients[i].state = STATE_TCP_CONNECTED;
                        clients[i].player_id = all_players[i].id;
                        
                        all_players[i].zone_y = 0; // Initialize zone

                        add_player_to_room(&global_room, &all_players[i]);
                        
                        fds[i + 1].fd = client_fd;
                        added = 1;
                        printf("Client connected: fd %d mapped to Player ID %d\n", client_fd, clients[i].player_id);
                        break;
                    }
                }
                
                if (!added) {
                    printf("Max clients reached. Rejecting connection.\n");
                    close(client_fd);
                }
            }
        }

        // Process client I/O multiplexing
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (clients[i].is_active && fds[i + 1].fd != -1) {
                if (fds[i + 1].revents & POLLIN) {
                    uint8_t read_buffer[4096];
                    ssize_t bytes_read = recv(clients[i].fd, read_buffer, sizeof(read_buffer) - 1, 0);
                    
                    if (bytes_read <= 0) {
                        // Connection closed or error
                        printf("Client disconnected: Player ID %d\n", clients[i].player_id);
                        close(clients[i].fd);
                        clients[i].is_active = 0;
                        clients[i].fd = -1;
                        fds[i + 1].fd = -1;

                        remove_player_from_room(&global_room, &all_players[i]);
                    } else {
                        if (clients[i].state == STATE_TCP_CONNECTED) {
                            read_buffer[bytes_read] = '\0'; // ensure null termination for string processing
                            char response[512];
                            if (generate_ws_handshake((char*)read_buffer, response, sizeof(response))) {
                                send(clients[i].fd, response, strlen(response), 0);
                                clients[i].state = STATE_WS_ACTIVE;
                                printf("WS handshake successful for Player ID %d\n", clients[i].player_id);
                            } else {
                                close(clients[i].fd);
                                clients[i].is_active = 0;
                                clients[i].fd = -1;
                                fds[i + 1].fd = -1;
                                remove_player_from_room(&global_room, &all_players[i]);
                            }
                        } else if (clients[i].state == STATE_WS_ACTIVE) {
                            uint8_t fin, opcode;
                            uint8_t *payload = NULL;
                            size_t payload_len = 0;
                            size_t consumed = 0;
                            size_t offset = 0;

                            while (offset < bytes_read) {
                                WSFrameResult res = parse_websocket_frame(read_buffer + offset, bytes_read - offset, &fin, &opcode, &payload, &payload_len, &consumed);
                                if (res == WS_FRAME_OK) {
                                    if (opcode == WS_OPCODE_CLOSE) {
                                        close(clients[i].fd);
                                        clients[i].is_active = 0;
                                        clients[i].fd = -1;
                                        fds[i + 1].fd = -1;
                                        remove_player_from_room(&global_room, &all_players[i]);
                                        break;
                                    } else if (opcode == WS_OPCODE_BINARY) {
                                        handle_client_message(&clients[i], payload, payload_len);
                                    }
                                    offset += consumed;
                                } else {
                                    break; // Incomplete or error (simple implementation drops fragments across read boundaries)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    close(server_fd);
    return 0;
}
