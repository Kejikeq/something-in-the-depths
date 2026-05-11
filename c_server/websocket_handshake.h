#ifndef WEBSOCKET_HANDSHAKE_H
#define WEBSOCKET_HANDSHAKE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Extracts the Sec-WebSocket-Key from an HTTP request.
// Returns 1 on success, 0 on failure.
int get_websocket_key(const char *http_req, char *key_out, size_t max_len);

// Generates the HTTP/1.1 101 Switching Protocols response.
// Returns 1 on success, 0 on failure.
int generate_ws_handshake(const char *http_req, char *response_out, size_t response_max);

#ifdef __cplusplus
}
#endif

#endif // WEBSOCKET_HANDSHAKE_H
