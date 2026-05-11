#ifndef WEBSOCKET_FRAME_H
#define WEBSOCKET_FRAME_H

#include <stdint.h>
#include <stddef.h>
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

// WebSocket Frame Opcodes
#define WS_OPCODE_CONT   0x0
#define WS_OPCODE_TEXT   0x1
#define WS_OPCODE_BINARY 0x2
#define WS_OPCODE_CLOSE  0x8
#define WS_OPCODE_PING   0x9
#define WS_OPCODE_PONG   0xA

// Frame parsing result enumeration
typedef enum {
    WS_FRAME_OK = 0,
    WS_FRAME_INCOMPLETE,
    WS_FRAME_ERROR
} WSFrameResult;

// Parses a websocket frame, unmasks it in place if masked,
// and extracts out necessary information.
// buffer: Pointer to raw received data
// buffer_len: Length of raw data available
// out_fin: Output for FIN bit
// out_opcode: Output for Opcode
// out_payload: Output for pointer to the unmasked payload data within the buffer
// out_payload_length: Output for payload length
// bytes_consumed: Output for the total frame size (header + payload)
WSFrameResult parse_websocket_frame(
    uint8_t *buffer, 
    size_t buffer_len, 
    uint8_t *out_fin, 
    uint8_t *out_opcode, 
    uint8_t **out_payload, 
    size_t *out_payload_length, 
    size_t *bytes_consumed
);

// Parses a move packet from the unmasked payload
// payload: The unmasked payload data
// payload_len: Length of the payload
// out_packet: The output move packet structure
int extract_move_packet(const uint8_t *payload, size_t payload_len, MovePacketType104 *out_packet);

#ifdef __cplusplus
}
#endif

#endif // WEBSOCKET_FRAME_H
