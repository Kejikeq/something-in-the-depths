#include "websocket_handshake.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>

// --- Base64 Encoder ---
static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

void base64_encode(const unsigned char *src, size_t len, char *out) {
    size_t i, j;
    for (i = 0, j = 0; i < len; i += 3) {
        uint32_t val = (src[i] << 16) | ((i + 1 < len ? src[i+1] : 0) << 8) | ((i + 2 < len ? src[i+2] : 0));
        out[j++] = b64_table[(val >> 18) & 0x3F];
        out[j++] = b64_table[(val >> 12) & 0x3F];
        out[j++] = (i + 1 < len) ? b64_table[(val >> 6) & 0x3F] : '=';
        out[j++] = (i + 2 < len) ? b64_table[val & 0x3F] : '=';
    }
    out[j] = '\0';
}

// --- SHA-1 Implementation ---
#define SHA1_ROTL(bits, word) (((word) << (bits)) | ((word) >> (32 - (bits))))

typedef struct {
    uint32_t state[5];
    uint32_t count[2];
    unsigned char buffer[64];
} SHA1_CTX;

void SHA1_Init(SHA1_CTX *context) {
    context->state[0] = 0x67452301;
    context->state[1] = 0xEFCDAB89;
    context->state[2] = 0x98BADCFE;
    context->state[3] = 0x10325476;
    context->state[4] = 0xC3D2E1F0;
    context->count[0] = context->count[1] = 0;
}

void SHA1_Transform(uint32_t state[5], const unsigned char buffer[64]) {
    uint32_t a, b, c, d, e;
    uint32_t w[80];
    int i;

    for (i = 0; i < 16; i++) {
        w[i] = (buffer[i*4] << 24) | (buffer[i*4+1] << 16) | (buffer[i*4+2] << 8) | buffer[i*4+3];
    }
    for (i = 16; i < 80; i++) {
        w[i] = SHA1_ROTL(1, w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16]);
    }

    a = state[0]; b = state[1]; c = state[2]; d = state[3]; e = state[4];

    for (i = 0; i < 80; i++) {
        uint32_t f, k;
        if (i < 20) {
            f = (b & c) | ((~b) & d);
            k = 0x5A827999;
        } else if (i < 40) {
            f = b ^ c ^ d;
            k = 0x6ED9EBA1;
        } else if (i < 60) {
            f = (b & c) | (b & d) | (c & d);
            k = 0x8F1BBCDC;
        } else {
            f = b ^ c ^ d;
            k = 0xCA62C1D6;
        }
        uint32_t temp = SHA1_ROTL(5, a) + f + e + k + w[i];
        e = d;
        d = c;
        c = SHA1_ROTL(30, b);
        b = a;
        a = temp;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
}

void SHA1_Update(SHA1_CTX *context, const unsigned char *data, uint32_t len) {
    uint32_t i, j;
    j = (context->count[0] >> 3) & 63;
    if ((context->count[0] += len << 3) < (len << 3)) context->count[1]++;
    context->count[1] += (len >> 29);
    
    if ((j + len) > 63) {
        memcpy(&context->buffer[j], data, (i = 64 - j));
        SHA1_Transform(context->state, context->buffer);
        for (; i + 63 < len; i += 64) {
            SHA1_Transform(context->state, &data[i]);
        }
        j = 0;
    } else {
        i = 0;
    }
    
    memcpy(&context->buffer[j], &data[i], len - i);
}

void SHA1_Final(unsigned char digest[20], SHA1_CTX *context) {
    unsigned char finalcount[8];
    for (int i = 0; i < 8; i++) {
        finalcount[i] = (unsigned char)((context->count[(i >= 4 ? 0 : 1)] >> ((3 - (i & 3)) * 8)) & 255);
    }
    
    unsigned char c = 0200;
    SHA1_Update(context, &c, 1);
    while ((context->count[0] & 504) != 448) {
        c = 0000;
        SHA1_Update(context, &c, 1);
    }
    SHA1_Update(context, finalcount, 8);
    for (int i = 0; i < 20; i++) {
        digest[i] = (unsigned char)((context->state[i >> 2] >> ((3 - (i & 3)) * 8)) & 255);
    }
}

// --- WebSocket Handshake Logic ---

int get_websocket_key(const char *http_req, char *key_out, size_t max_len) {
    const char *header_key = "Sec-WebSocket-Key:";
    const char *p = strstr(http_req, header_key);
    if (!p) return 0;
    
    p += strlen(header_key);
    while (*p == ' ' || *p == '\t') p++;
    
    size_t i = 0;
    while (*p && *p != '\r' && *p != '\n' && i < max_len - 1) {
        key_out[i++] = *p++;
    }
    key_out[i] = '\0';
    return i > 0;
}

int generate_ws_handshake(const char *http_req, char *response_out, size_t response_max) {
    char client_key[256];
    if (!get_websocket_key(http_req, client_key, sizeof(client_key))) {
        return 0; // Not a valid websocket request
    }

    char concatenated[512];
    snprintf(concatenated, sizeof(concatenated), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", client_key);

    SHA1_CTX ctx;
    unsigned char digest[20];
    SHA1_Init(&ctx);
    SHA1_Update(&ctx, (const unsigned char *)concatenated, strlen(concatenated));
    SHA1_Final(digest, &ctx);

    char base64_hash[64];
    base64_encode(digest, 20, base64_hash);

    snprintf(response_out, response_max,
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n\r\n",
        base64_hash
    );

    return 1;
}
