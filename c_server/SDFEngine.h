#pragma once

#include <cmath>
#include <algorithm>
#include <array>
#include <unordered_map>
#include <cstdint>
#include <vector>

// Vector Math primitives equivalent to GLSL
struct vec2 {
    float x, y;
    vec2() : x(0), y(0) {}
    vec2(float _x, float _y) : x(_x), y(_y) {}
    vec2 operator-(const vec2& o) const { return vec2(x - o.x, y - o.y); }
    vec2 operator+(const vec2& o) const { return vec2(x + o.x, y + o.y); }
    vec2 operator*(float s) const { return vec2(x * s, y * s); }
};

struct vec3 {
    float x, y, z;
    vec3() : x(0), y(0), z(0) {}
    vec3(float _x, float _y, float _z) : x(_x), y(_y), z(_z) {}
    vec3 operator-(const vec3& o) const { return vec3(x - o.x, y - o.y, z - o.z); }
    vec3 operator+(const vec3& o) const { return vec3(x + o.x, y + o.y, z + o.z); }
    vec3 operator*(float s) const { return vec3(x * s, y * s, z * s); }
};

struct vec4 {
    float x, y, z, w;
};

// Math functions
inline float dot(vec3 a, vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float length(vec3 v) { return std::sqrt(dot(v, v)); }
inline float length(vec2 v) { return std::sqrt(v.x * v.x + v.y * v.y); }
inline vec2 abs_vec(vec2 v) { return vec2(std::abs(v.x), std::abs(v.y)); }
inline vec3 abs_vec(vec3 v) { return vec3(std::abs(v.x), std::abs(v.y), std::abs(v.z)); }

inline float max_f(float a, float b) { return std::max(a, b); }
inline float min_f(float a, float b) { return std::min(a, b); }
inline vec2 max_vec(vec2 v, float f) { return vec2(max_f(v.x, f), max_f(v.y, f)); }
inline vec3 max_vec(vec3 v, float f) { return vec3(max_f(v.x, f), max_f(v.y, f), max_f(v.z, f)); }
inline float clamp_f(float v, float lo, float hi) { return max_f(lo, min_f(v, hi)); }

// Fixed array of 64 HoleStruct elements as per requirements
struct HoleStruct {
    float x, y, z, r;
};

struct ChunkGrid {
    float data[33 * 33 * 33]; // Density grid
    float mats[33 * 33 * 33]; // Material grid
    bool initialized = false;
};

class SDFEngine {
public:
    HoleStruct holes[2048];
    int numHoles = 0;
    int holeIndex = 0;
    
    std::unordered_map<uint64_t, ChunkGrid> voxelGrids;

    uint64_t getChunkKey(int x, int y, int z) {
        // Correct chunk rounding for both positive and negative coords
        int cx = (x >= 0) ? (x / 32) : ((x - 31) / 32);
        int cy = (y >= 0) ? (y / 32) : ((y - 31) / 32);
        int cz = (z >= 0) ? (z / 32) : ((z - 31) / 32);
        return ((uint64_t)(cx & 0xFFFFF)) | (((uint64_t)(cy & 0xFFFFF)) << 20) | (((uint64_t)(cz & 0xFFFFF)) << 40);
    }

    // Base Modifiers
    float sdCylinder(vec3 p, float r, float h);
    float sdBox(vec3 p, vec3 b);
    float sdCapsule(vec3 p, vec3 a, vec3 b, float r);
    float smin(float a, float b, float k);
    float smax(float a, float b, float k);
    float sinNoise(vec3 p);

    // Geometry
    vec2 sdSakuraTree(vec3 p);
    vec2 sdLift(vec3 p, float uLiftY, float uTime);
    vec2 sdBridge(vec3 p);
    float sdTerrain(vec3 p);

    // Analytical Digging
    float intersectHolesAnalytical(vec3 ro, vec3 rd, float maxDist);
    
    float getDistance(vec3 p) {
        float maxInside = -1000.0f;
        for (int i = 0; i < numHoles && i < 2048; ++i) {
            float dx = p.x - holes[i].x;
            float dz = p.z - holes[i].z;
            float d2d = std::sqrt(dx*dx + dz*dz);
            float d = holes[i].r - d2d;
            maxInside = std::max(maxInside, d);
        }
        return maxInside;
    }

    // Master scene graph map
    vec2 map(vec3 p, float uLiftY, float uTime);
};
