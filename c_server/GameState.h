#pragma once

#include "SDFEngine.h"

// Keys array mapping standard: 0: W, 1: A, 2: S, 3: D

class GameState {
public:
    // Player State
    vec3 pos;
    vec3 vel;
    float yaw;
    float pitch;
    
    // Scene Engine instance
    SDFEngine sdfEngine;

    // Optional variables to match TS reference
    float liftY = 0.0f;
    float uTime = 0.0f;
    float gDist = 0.0f;

    GameState();

    // Physics Step
    void tick(float deltaTime, float moveX, float moveZ, bool jump);

    // Digging Logic
    void tryDig(vec3 camDir);

private:
    vec3 getNormal(vec3 p);
    void applyCollision(float dt);
};
