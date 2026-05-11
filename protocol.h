#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <stdint.h>

#pragma pack(push, 1)

// Baseline structs as per technical specifications
typedef struct {
    uint8_t type;
    uint16_t payload_size;
} PacketHeader;

typedef struct {
    int32_t id;
    float x;
    float y;
    float z;
    int32_t zone_y;
} PlayerStruct;

// Alias to Player as mentioned in memory pool requirements
typedef PlayerStruct Player;

// Structure matching the 13-byte binary Move packet from NetworkClient.ts
// [Type: 1 byte (104), x: float32, y: float32, z: float32]
typedef struct {
    uint8_t type;
    float x;
    float y;
    float z;
} MovePacketType104;

typedef struct {
    float x;
    float y;
    float z;
    float r;
} HoleStruct;

#pragma pack(pop)

#define MAX_CLIENTS 1024
#define SERVER_PORT 3000
#define ZONE_SIZE 50
#define MAX_HOLES 64
#define MAX_ROOM_PLAYERS 128

typedef struct Room {
    HoleStruct holes[MAX_HOLES];
    int hole_count;
    int hole_index; // Circular buffer index for FIFO eviction

    Player* players[MAX_ROOM_PLAYERS];
    int player_count;
} Room;

#endif // PROTOCOL_H
