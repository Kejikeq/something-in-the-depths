#include "websocket_frame.h"
#include <string.h>

WSFrameResult parse_websocket_frame(
    uint8_t *buffer, 
    size_t buffer_len, 
    uint8_t *out_fin, 
    uint8_t *out_opcode, 
    uint8_t **out_payload, 
    size_t *out_payload_length, 
    size_t *bytes_consumed
) {
    if (buffer_len < 2) {
        return WS_FRAME_INCOMPLETE;
    }

    *out_fin = (buffer[0] & 0x80) >> 7;
    *out_opcode = buffer[0] & 0x0F;

    uint8_t masked = (buffer[1] & 0x80) >> 7;
    uint8_t payload_len_7bit = buffer[1] & 0x7F;

    size_t header_len = 2;
    uint64_t payload_len = 0;

    if (payload_len_7bit == 126) {
        if (buffer_len < 4) return WS_FRAME_INCOMPLETE;
        payload_len = ((uint64_t)buffer[2] << 8) | buffer[3];
        header_len += 2;
    } else if (payload_len_7bit == 127) {
        if (buffer_len < 10) return WS_FRAME_INCOMPLETE;
        payload_len = 0;
        for (int i = 0; i < 8; i++) {
            payload_len = (payload_len << 8) | buffer[2 + i];
        }
        header_len += 8;
    } else {
        payload_len = payload_len_7bit;
    }

    uint8_t masking_key[4] = {0};
    if (masked) {
        if (buffer_len < header_len + 4) return WS_FRAME_INCOMPLETE;
        memcpy(masking_key, buffer + header_len, 4);
        header_len += 4;
    }

    if (buffer_len < header_len + payload_len) {
        return WS_FRAME_INCOMPLETE;
    }

    uint8_t *payload = buffer + header_len;

    // Unmask the payload in-place
    if (masked) {
        for (size_t i = 0; i < payload_len; i++) {
            payload[i] ^= masking_key[i % 4];
        }
    }

    if (out_payload) *out_payload = payload;
    if (out_payload_length) *out_payload_length = (size_t)payload_len;
    if (bytes_consumed) *bytes_consumed = header_len + payload_len;

    return WS_FRAME_OK;
}

int extract_move_packet(const uint8_t *payload, size_t payload_len, MovePacketType104 *out_packet) {
    if (!payload || !out_packet) return 0;
    
    if (payload_len == sizeof(MovePacketType104)) {
        MovePacketType104 *pkt = (MovePacketType104 *)payload;
        if (pkt->type == 104) {
            *out_packet = *pkt;
            return 1;
        }
    }
    
    return 0; // Not a move packet Type 104 or incorrect length
}
