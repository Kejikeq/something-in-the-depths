#include "GameState.h"
#include <vector>
#include <algorithm>

// Physics Constants mapped from WorldEngine.CONFIG
const float GRAVITY = -15.0f;
const float MOVE_SPEED = 8.0f;
const float JUMP_STRENGTH = 6.5f;
const float PLAYER_HEIGHT = 1.4f;

GameState::GameState() {
    pos = vec3(0.0f, 1.5f, 66.0f); // Default start
    vel = vec3(0.0f, 0.0f, 0.0f);
    yaw = 3.14f;
    pitch = -0.1f;
}

vec3 GameState::getNormal(vec3 p) {
    const float eps = 0.05f;
    float nx = sdfEngine.map(vec3(p.x + eps, p.y, p.z), liftY, uTime).x - sdfEngine.map(vec3(p.x - eps, p.y, p.z), liftY, uTime).x;
    float ny = sdfEngine.map(vec3(p.x, p.y + eps, p.z), liftY, uTime).x - sdfEngine.map(vec3(p.x, p.y - eps, p.z), liftY, uTime).x;
    float nz = sdfEngine.map(vec3(p.x, p.y, p.z + eps), liftY, uTime).x - sdfEngine.map(vec3(p.x, p.y, p.z - eps), liftY, uTime).x;
    float len = std::sqrt(nx*nx + ny*ny + nz*nz);
    if (len < 0.0001f) return vec3(0.0f, 1.0f, 0.0f);
    return vec3(nx/len, ny/len, nz/len);
}

void GameState::tick(float deltaTime, float moveX, float moveZ, bool jump) {
    uTime += deltaTime * 1000.0f; // Update time (milliseconds equivalent)

    // Apply movement
    float moveLen = std::sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLen > 0.01f) {
        // Normalization is handled by the caller or applyJoystickInput, 
        // but we ensure it here too just in case.
        float normX = moveX;
        float normZ = moveZ;
        if (moveLen > 1.0f) {
            normX /= moveLen;
            normZ /= moveLen;
        }
        vel.x = normX * MOVE_SPEED;
        vel.z = normZ * MOVE_SPEED;
    } else {
        vel.x *= 0.001f;
        vel.z *= 0.001f;
    }
    
    // Implement Gravity and Jumping
    vel.y += GRAVITY * deltaTime;
    
    bool inHole = (28.0f - std::sqrt(pos.x*pos.x + pos.z*pos.z)) > 0.0f;
    
    float liftHover = std::sin(uTime * 0.4f) * 0.08f;
    float expected_y = -0.4f + liftY + liftHover + 0.12f;
    float liftRadius = 2.2f;
    // Строгая проверка по оси Y (расстояние до платформы меньше 5.0f), чтобы лифт не хватал игрока со дна
    bool onLift = (std::abs(pos.x) < liftRadius && std::abs(pos.z - 2.5f) < liftRadius && std::abs(pos.y - expected_y) < 5.0f);
    
    float distToFloor = 1000.0f;
    if (inHole || onLift) {
        float min_y = -499.2f;
        if (onLift) {
            min_y = expected_y;
        } else {
            if (pos.y - PLAYER_HEIGHT >= -115.0f) min_y = -115.0f;
            else if (pos.y - PLAYER_HEIGHT >= -235.0f) min_y = -235.0f;
            else if (pos.y - PLAYER_HEIGHT >= -355.0f) min_y = -355.0f;
            else if (pos.y - PLAYER_HEIGHT >= -440.0f) min_y = -440.0f;
            else min_y = -499.2f;
        }
        distToFloor = (pos.y - PLAYER_HEIGHT) - min_y;
    } else {
        distToFloor = sdfEngine.map(vec3(pos.x, pos.y - PLAYER_HEIGHT, pos.z), liftY, uTime).x / 0.65f;
    }
    
    if (jump && distToFloor < 0.1f && vel.y <= 0.1f) {
        vel.y = JUMP_STRENGTH;
    } else if (distToFloor < 0.06f && vel.y < 0.0f) {
        vel.y = 0.0f;
    }
    
    applyCollision(deltaTime);
}

void GameState::applyCollision(float dt) {
    if (vel.y < -30.0f) vel.y = -30.0f; // Terminal velocity
    
    // Preliminary Movement
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    
    bool inHole = (28.0f - std::sqrt(pos.x*pos.x + pos.z*pos.z)) > 0.0f;
    float liftHover = std::sin(uTime * 0.4f) * 0.08f;
    float expected_y = -0.4f + liftY + liftHover + 0.12f;
    float liftRadius = 2.2f;
    bool onLift = (std::abs(pos.x) < liftRadius && std::abs(pos.z - 2.5f) < liftRadius && std::abs(pos.y - expected_y) < 5.0f);
    
    float min_y = -499.2f;
    if (onLift) {
        min_y = expected_y;
    } else if (inHole) {
        if (pos.y - PLAYER_HEIGHT >= -115.0f) min_y = -115.0f;
        else if (pos.y - PLAYER_HEIGHT >= -235.0f) min_y = -235.0f;
        else if (pos.y - PLAYER_HEIGHT >= -355.0f) min_y = -355.0f;
        else if (pos.y - PLAYER_HEIGHT >= -440.0f) min_y = -440.0f;
        else min_y = -499.2f;
    }

    if (!inHole && !onLift) {
        // Full 3D Capsule-like Collision
        const float radius = 0.35f;
        for (int i = 0; i < 4; i++) {
            // Check feet
            vec3 footPos = vec3(pos.x, pos.y - PLAYER_HEIGHT + radius, pos.z);
            float distF = sdfEngine.map(footPos, liftY, uTime).x;
            if (distF < radius) {
                vec3 n = getNormal(footPos);
                float pen = radius - distF;
                pos.x += n.x * pen;
                pos.y += n.y * pen;
                pos.z += n.z * pen;
                float vn = vel.x*n.x + vel.y*n.y + vel.z*n.z;
                if (vn < 0.0f) {
                    vel.x -= vn * n.x;
                    vel.y -= vn * n.y;
                    vel.z -= vn * n.z;
                }
            }
            // Check waist
            vec3 waistPos = vec3(pos.x, pos.y - 0.7f, pos.z);
            float distW = sdfEngine.map(waistPos, liftY, uTime).x;
            if (distW < radius) {
                vec3 n = getNormal(waistPos);
                float pen = radius - distW;
                pos.x += n.x * pen;
                pos.y += n.y * pen;
                pos.z += n.z * pen;
                float vn = vel.x*n.x + vel.y*n.y + vel.z*n.z;
                if (vn < 0.0f) {
                    vel.x -= vn * n.x;
                    vel.y -= vn * n.y;
                    vel.z -= vn * n.z;
                }
            }
        }
        
        // Ground sticking evaluation
        gDist = sdfEngine.map(vec3(pos.x, pos.y - PLAYER_HEIGHT, pos.z), liftY, uTime).x;
        // If we're very close to the ground and travelling down slowly, snap to prevent jittering
        if (gDist < 0.05f && gDist > -0.1f && vel.y <= 0.01f) {
            vec3 n = getNormal(vec3(pos.x, pos.y - PLAYER_HEIGHT, pos.z));
            // Only snap if surface is somewhat flat
            if (n.y > 0.5f) {
                pos.y += (0.02f - gDist) * n.y;
                vel.y = 0.0f;
            }
        }
    } else {
        // Fall to the closest plane floor
        if (pos.y - PLAYER_HEIGHT < min_y) {
            pos.y = min_y + PLAYER_HEIGHT;
            if (vel.y < 0.0f) vel.y = 0.0f;
        }
    }

    // World floor death limit
    if (pos.y < -510.0f) {
        pos = vec3(0.0f, 1.5f, 66.0f);
        yaw = 3.14f;
        pitch = -0.1f;
        vel.y = 0.0f;
    }
}

void GameState::tryDig(vec3 camDir) {
    // Digging raymarch MUST ignore uLiftY to avoid hitting the "visual swelling" near player
    float marchT = 0.2f; 
    bool hitFound = false;
    float hitX, hitY, hitZ;

    const float maxDigDist = 25.0f; // Increased range
    const int maxSteps = 120; // More steps for precision
    
    for (int i = 0; i < maxSteps; i++) {
        vec3 p = pos + camDir * marchT;
        // CRITICAL: We use 0.0f for liftY here so we hit the ACTUAL terrain
        float d = sdfEngine.map(p, 0.0f, uTime).x;
        
        if (d < 0.02f) { // Precise hit threshold
            hitX = p.x; hitY = p.y; hitZ = p.z;
            hitFound = true;
            break;
        }
        
        // Sphere tracing with safety factor for non-conservative terrain
        // but ensure a minimum step to not get stuck
        marchT += max_f(d * 0.85f, 0.1f);
        
        if (marchT > maxDigDist) break;
    }

    if (hitFound) {
        // Physical voxel modification
        sdfEngine.digVoxel(vec3(hitX, hitY, hitZ), 1.6f);
    }
}
