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
    const float eps = 0.01f;
    float d = sdfEngine.map(p, liftY, uTime).x;
    float nx = sdfEngine.map(vec3(p.x + eps, p.y, p.z), liftY, uTime).x - d;
    float ny = sdfEngine.map(vec3(p.x, p.y + eps, p.z), liftY, uTime).x - d;
    float nz = sdfEngine.map(vec3(p.x, p.y, p.z + eps), liftY, uTime).x - d;
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
    // Horizontal Movement
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    
    // Wall Collisions
    float collisionY = pos.y - 0.7f; // Check around waist
    const float wallThreshold = 0.35f; // Slightly smaller to prevent sticking
    for (int i = 0; i < 8; i++) { // Increased iterations for stability
        float dist = sdfEngine.map(vec3(pos.x, collisionY, pos.z), liftY, uTime).x;
        if (dist < wallThreshold) {
            vec3 n = getNormal(vec3(pos.x, collisionY, pos.z));
            pos.x += n.x * (wallThreshold - dist) * 1.2f; // Increased push-out factor
            pos.z += n.z * (wallThreshold - dist) * 1.2f;
        } else {
            break; // Early exit if no collision
        }
    }
    
    // Vertical Movement
    if (vel.y < -30.0f) vel.y = -30.0f; // Terminal velocity
    pos.y += vel.y * dt;
    
    bool inHole = (28.0f - std::sqrt(pos.x*pos.x + pos.z*pos.z)) > 0.0f;
    
    float liftHover = std::sin(uTime * 0.4f) * 0.08f;
    float expected_y = -0.4f + liftY + liftHover + 0.12f;
    float liftRadius = 2.2f;
    // Строгая проверка по оси Y (расстояние до платформы меньше 5.0f), чтобы лифт не хватал игрока со дна
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
        // Normal surface SDF collision
        gDist = sdfEngine.map(vec3(pos.x, pos.y - PLAYER_HEIGHT, pos.z), liftY, uTime).x / 0.65f;
        
        if (gDist < -0.1f) { // More lenient snap threshold
            pos.y += (-gDist + 0.02f);
            if (vel.y < 0.0f) vel.y = 0.0f;
        } else if (gDist < 0.05f) { // Tighter floor stick
            float adjust = 0.05f - gDist;
            if (vel.y <= 0.0f) {
                pos.y += adjust;
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
    // Digging Logic Using Analytical Intersection
    std::vector<float> candidates;

    // 1. Plane Intersections
    float planes[] = {0.0f, -115.0f, -235.0f, -355.0f, -440.0f, -499.2f};
    if (std::abs(camDir.y) > 0.001f) {
        for (float py : planes) {
            float t = (py - pos.y) / camDir.y;
            if (t > 0.0f && t < 8.0f) candidates.push_back(t);
        }
    }

    // 2. Exact Analytical Distances tracking down holes array
    float tHole = sdfEngine.intersectHolesAnalytical(pos, camDir, 8.0f);
    if (tHole < 8.0f) {
        candidates.push_back(tHole);
    }
    
    std::sort(candidates.begin(), candidates.end());

    bool hitFound = false;
    float hitX, hitY, hitZ;

    for (float t : candidates) {
        float px = pos.x + camDir.x * t;
        float py = pos.y + camDir.y * t;
        float pz = pos.z + camDir.z * t;
        
        float dist = sdfEngine.map(vec3(px, py, pz), liftY, uTime).x;
        if (dist < 0.2f) {
            hitX = px; hitY = py; hitZ = pz;
            hitFound = true;
            break;
        }
    }

    // Fallback Raymarching for edges
    if (!hitFound) {
        float marchT = 0.0f;
        for (int i = 0; i < 4; i++) {
            float px = pos.x + camDir.x * marchT;
            float py = pos.y + camDir.y * marchT;
            float pz = pos.z + camDir.z * marchT;
            float dist = sdfEngine.map(vec3(px, py, pz), liftY, uTime).x;
            if (dist < 0.2f) {
                hitX = px; hitY = py; hitZ = pz;
                hitFound = true;
                break;
            }
            marchT += max_f(dist, 0.5f);
            if (marchT > 8.0f) break;
        }
    }

    if (hitFound) {
        // Update the circular buffer of 64 holes
        int idx = sdfEngine.holeIndex;
        sdfEngine.holes[idx].x = hitX;
        sdfEngine.holes[idx].y = hitY;
        sdfEngine.holes[idx].z = hitZ;
        sdfEngine.holes[idx].r = 1.3f;
        
        sdfEngine.holeIndex = (sdfEngine.holeIndex + 1) % 64;
        if (sdfEngine.numHoles < 64) {
            sdfEngine.numHoles++;
        }
    }
}
