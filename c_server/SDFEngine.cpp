#include "SDFEngine.h"

// Core Geometry Primitives
float SDFEngine::sinNoise(vec3 p) {
    float n = std::sin(p.x) * std::sin(p.y) * std::sin(p.z);
    n += 0.5f * std::sin(p.x * 2.1f + 1.2f) * std::sin(p.y * 2.1f + 3.4f) * std::sin(p.z * 2.1f + 5.6f);
    return n;
}

float SDFEngine::sdCylinder(vec3 p, float r, float h) {
    vec2 d = abs_vec(vec2(length(vec2(p.x, p.z)), p.y)) - vec2(r, h);
    return min_f(max_f(d.x, d.y), 0.0f) + length(max_vec(d, 0.0f));
}

float SDFEngine::sdBox(vec3 p, vec3 b) {
    vec3 q = abs_vec(p) - b;
    return length(max_vec(q, 0.0f)) + min_f(max_f(q.x, max_f(q.y, q.z)), 0.0f);
}

float SDFEngine::sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp_f(dot(pa, ba) / dot(ba, ba), 0.0f, 1.0f);
    return length(pa - ba * h) - r;
}

float SDFEngine::smin(float a, float b, float k) {
    float h = max_f(k - std::abs(a - b), 0.0f) / k;
    return min_f(a, b) - h * h * h * k * (1.0f / 6.0f);
}

float SDFEngine::smax(float a, float b, float k) {
    float h = max_f(k - std::abs(a - b), 0.0f) / k;
    return max_f(a, b) + h * h * h * k * (1.0f / 6.0f);
}

// Scene Elements
vec2 SDFEngine::sdSakuraTree(vec3 p) {
    vec3 tp = p;
    float boundingD = length(tp - vec3(0.0f, 5.0f, 0.0f)) - 10.0f;
    if (boundingD > 2.0f) return vec2(boundingD, boundingD);

    float trunkBend = std::sin(tp.y * 0.2f) * 1.2f;
    vec3 trunkP = vec3(tp.x - trunkBend, tp.y - 4.0f, tp.z);
    float radius = 0.4f * (1.2f - tp.y * 0.08f);
    float dWood = sdCylinder(trunkP, max_f(radius, 0.05f), 4.0f);
    
    float branches = 1000.0f;
    branches = smin(branches, sdCapsule(tp, vec3(std::sin(3.5f * 0.2f) * 1.2f, 3.5f, 0.0f), vec3(4.0f, 8.0f, 1.5f), 0.25f), 0.4f);
    branches = smin(branches, sdCapsule(tp, vec3(std::sin(4.5f * 0.2f) * 1.2f, 4.5f, 0.0f), vec3(-3.5f, 8.5f, -1.0f), 0.2f), 0.4f);
    branches = smin(branches, sdCapsule(tp, vec3(std::sin(6.0f * 0.2f) * 1.2f, 6.0f, 0.0f), vec3(1.5f, 9.5f, -3.5f), 0.15f), 0.4f);
    branches = smin(branches, sdCapsule(tp, vec3(std::sin(5.5f * 0.2f) * 1.2f, 5.5f, 0.0f), vec3(-2.0f, 7.5f, 2.5f), 0.18f), 0.4f);
    
    dWood = smin(dWood, branches, 0.4f);

    float dL1 = length(tp - vec3(0.0f, 9.5f, 0.0f)) - 3.5f;
    float dL2 = length(tp - vec3(4.5f, 8.0f, 1.8f)) - 3.0f;
    float dL3 = length(tp - vec3(-4.0f, 8.5f, -1.5f)) - 3.2f;
    float dL4 = length(tp - vec3(2.0f, 9.8f, -4.0f)) - 2.8f;
    float dL5 = length(tp - vec3(-2.5f, 7.0f, 3.0f)) - 2.5f;

    float dLeaves = min_f(dL1, min_f(dL2, min_f(dL3, min_f(dL4, dL5))));
    dLeaves = smin(dLeaves, dL1, 1.0f);
    dLeaves = smin(dLeaves, dL2, 0.8f);
    dLeaves = smin(dLeaves, dL3, 0.8f);
    dLeaves = smin(dLeaves, dL4, 0.8f);
    dLeaves = smin(dLeaves, dL5, 0.8f);

    return vec2(dWood, dLeaves);
}

vec2 SDFEngine::sdLift(vec3 p, float uLiftY, float uTime) {
    vec3 liftPos = vec3(0.0f, -0.4f + uLiftY + std::sin(uTime * 0.4f) * 0.08f, 2.5f);
    
    float resDist = 1000.0f;
    float matID = 0.0f;

    float bLift = sdBox(p - liftPos - vec3(0.0f, 125.0f, 0.0f), vec3(2.5f, 126.0f, 2.5f));
    if (bLift < 10.0f) {
        float dLift = sdBox(p - liftPos, vec3(2.2f, 0.12f, 2.2f));
        float dChains = 1000.0f;
        dChains = min_f(dChains, sdCylinder(p - (liftPos + vec3(2.0f, 250.0f, 2.0f)), 0.06f, 250.0f));
        dChains = min_f(dChains, sdCylinder(p - (liftPos + vec3(-2.0f, 250.0f, 2.0f)), 0.06f, 250.0f));
        dChains = min_f(dChains, sdCylinder(p - (liftPos + vec3(2.0f, 250.0f, -2.0f)), 0.06f, 250.0f));
        dChains = min_f(dChains, sdCylinder(p - (liftPos + vec3(-2.0f, 250.0f, -2.0f)), 0.06f, 250.0f));

        if (dLift < dChains) {
            resDist = dLift; matID = 5.0f;
        } else {
            resDist = dChains; matID = 5.0f;
        }
    }
    return vec2(resDist, matID);
}

vec2 SDFEngine::sdBridge(vec3 p) {
    vec3 bridgePos = vec3(0.0f, -0.4f, 16.85f);
    float dBridge = sdBox(p - bridgePos, vec3(1.5f, 0.1f, 12.15f));
    float dFenceL = sdBox(p - vec3(1.4f, -0.2f, 16.85f), vec3(0.08f, 0.3f, 12.15f));
    float dFenceR = sdBox(p - vec3(-1.4f, -0.2f, 16.85f), vec3(0.08f, 0.3f, 12.15f));
    float dBridgeFences = min_f(dBridge, min_f(dFenceL, dFenceR));
    return vec2(dBridgeFences, 4.0f);
}

float SDFEngine::sdTerrain(vec3 p) {
    float dTerrain = p.y;
    
    float dEntrance = length(vec2(p.x, p.z)) - 28.0f;
    float wallNoise = sinNoise(p * 0.5f) * 1.5f; 
    float jaggedWalls = dEntrance + wallNoise;
    float dExcavation = max_f(jaggedWalls, -p.y - 150.0f);
    dTerrain = max_f(dTerrain, -dExcavation);

    if (p.y <= 0.0f) {
        float b = 0.0f;
        if (p.y > -120.0f) b = 1.0f;
        else if (p.y > -140.0f) b = 0.5f;
        else if (p.y > -240.0f) b = 2.0f;
        else if (p.y > -260.0f) b = 0.5f;
        else if (p.y > -360.0f) b = 3.0f;
        else if (p.y > -380.0f) b = 0.5f;
        else b = 4.0f;

        // Tunnel SDF - Matched to Shader
        float dTunnel = 1000.0f;
        for(int i = 1; i <= 3; i++) {
            float fi = (float)i;
            float seed = fi * 1.57f;
            float pxz_x = std::sin(p.y * 0.05f + seed) * 15.0f + std::cos(p.y * 0.02f) * 5.0f;
            float pxz_z = std::cos(p.y * 0.04f - seed) * 12.0f + std::sin(p.y * 0.01f) * 8.0f;
            
            float irregularity = sinNoise(p * 0.3f) * 1.2f;
            float tube = length(vec2(p.x - pxz_x, p.z - pxz_z)) - (2.2f + irregularity);
            
            float d1 = std::abs(p.y + 70.0f);
            float d2 = std::abs(p.y + 190.0f);
            float d3 = std::abs(p.y + 310.0f);
            float d4 = std::abs(p.y + 500.0f);
            float biomeFocus = min_f(min_f(d1, d2), min_f(d3, d4));
            
            float sm = (biomeFocus - 40.0f) / 40.0f;
            sm = max_f(0.0f, min_f(1.0f, sm));
            float smoothStep = sm * sm * (3.0f - 2.0f * sm);
            tube += smoothStep * 8.0f;
            dTunnel = min_f(dTunnel, tube);
        }
        dTerrain = max_f(dTerrain, -dTunnel);

        auto caveSDF = [&](vec3 cp, float floorY, float ceilY, float scale) {
            float cFloor = cp.y - floorY;
            float dome = (ceilY - cp.y) + sinNoise(cp * scale) * 4.5f;
            float walls = std::abs(sinNoise(cp * 0.08f)) - 0.45f;
            float bounds = length(vec2(cp.x, cp.z)) - 80.0f;
            return max_f(max_f(max_f(cFloor, dome), -walls), bounds);
        };

        if (b == 1.0f) {
            dTerrain = max_f(dTerrain, -caveSDF(p, -115.0f, -25.0f, 0.45f));
        } else if (b == 2.0f) {
            dTerrain = max_f(dTerrain, -caveSDF(p, -235.0f, -145.0f, 0.18f));
        } else if (b == 3.0f) {
            dTerrain = max_f(dTerrain, -caveSDF(p, -355.0f, -265.0f, 0.15f));
        } else if (b == 4.0f) {
            float abyssSlab = max_f(std::abs(p.y + 440.0f) - 60.0f, length(vec2(p.x, p.z)) - 100.0f);
            dTerrain = max_f(dTerrain, -abyssSlab);
        }
    }

    if (p.y > -10.0f) {
        float dWall = max_f(std::abs(length(vec2(p.x, p.z)) - 100.0f) - 1.25f, std::abs(p.y - 12.5f) - 12.5f);
        if (dWall < dTerrain) dTerrain = dWall;
    }
    
    return dTerrain;
}

float SDFEngine::getTerrainMat(vec3 p) {
    float r = length(vec2(p.x, p.z));
    if (r > 96.0f) return 1.0f; // Stone outer wall
    
    // Biomes by depth
    if (p.y > -2.0f) return 2.0f;  // Grass (using mat 2)
    if (p.y < -350.0f) return 6.0f; // Abyss
    if (p.y < -120.0f) return 5.0f; // Jungle (using mat 5)
    if (p.y < -15.0f) return 1.0f;  // Rock deep
    
    return 3.0f; // Dirt/Soil (using mat 3)
}

void SDFEngine::digVoxel(vec3 p, float r) {
    int xmin = (int)std::floor(p.x - r - 2.0f);
    int xmax = (int)std::ceil(p.x + r + 2.0f);
    int ymin = (int)std::floor(p.y - r - 2.0f);
    int ymax = (int)std::ceil(p.y + r + 2.0f);
    int zmin = (int)std::floor(p.z - r - 2.0f);
    int zmax = (int)std::ceil(p.z + r + 2.0f);

    for (int x = xmin; x <= xmax; x++) {
        for (int y = ymin; y <= ymax; y++) {
            for (int z = zmin; z <= zmax; z++) {
                // A point (x,y,z) can be on the boundary of up to 8 chunks.
                // We need to update all grids that share this voxel coordinate.
                for (int dx = -1; dx <= 0; dx++) {
                    for (int dy = -1; dy <= 0; dy++) {
                        for (int dz = -1; dz <= 0; dz++) {
                            int cx = ((x + dx * 32) / 32) * 32;
                            if (x + dx * 32 < 0) cx = ((x + dx * 32 - 31) / 32) * 32;
                            int cy = ((y + dy * 32) / 32) * 32;
                            if (y + dy * 32 < 0) cy = ((y + dy * 32 - 31) / 32) * 32;
                            int cz = ((z + dz * 32) / 32) * 32;
                            if (z + dz * 32 < 0) cz = ((z + dz * 32 - 31) / 32) * 32;

                            int lx = x - cx;
                            int ly = y - cy;
                            int lz = z - cz;

                            if (lx >= 0 && lx <= 32 && ly >= 0 && ly <= 32 && lz >= 0 && lz <= 32) {
                                uint64_t key = getChunkKey(cx, cy, cz);
                                auto it = voxelGrids.find(key);
                                ChunkGrid* grid = nullptr;
                                if (it == voxelGrids.end()) {
                                    grid = new ChunkGrid();
                                    grid->initialized = true;
                                    for (int lz2 = 0; lz2 <= 32; lz2++) {
                                        for (int ly2 = 0; ly2 <= 32; ly2++) {
                                            for (int lx2 = 0; lx2 <= 32; lx2++) {
                                                vec3 lp((float)(cx + lx2), (float)(cy + ly2), (float)(cz + lz2));
                                                int gidx2 = lx2 + ly2 * 33 + lz2 * 33 * 33;
                                                grid->data[gidx2] = sdTerrain(lp);
                                                grid->mats[gidx2] = getTerrainMat(lp);
                                            }
                                        }
                                    }
                                    voxelGrids[key] = grid;
                                } else {
                                    grid = it->second;
                                }

                                float ddx = (float)x - p.x;
                                float ddy = (float)y - p.y;
                                float ddz = (float)z - p.z;
                                float distToHole = r - std::sqrt(ddx*ddx + ddy*ddy + ddz*dz);
                                
                                int gidx = lx + ly * 33 + lz * 33 * 33;
                                if (distToHole > grid->data[gidx]) {
                                    grid->data[gidx] = distToHole;
                                    grid->mats[gidx] = getTerrainMat(vec3((float)x, (float)y, (float)z));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

float SDFEngine::getVoxelData(int x, int y, int z) {
    // We want to find a chunk that contains this point AND is initialized.
    // Standard chunk for (x,y,z) is getGrid(x,y,z).
    // But points on boundaries (multiple of 32) can be found in multiple chunks.
    
    auto trySample = [&](int cx, int cy, int cz) -> float {
        ChunkGrid* g = getGrid(cx, cy, cz);
        if (g && g->initialized) {
            int lx = x - cx;
            int ly = y - cy;
            int lz = z - cz;
            if (lx >= 0 && lx <= 32 && ly >= 0 && ly <= 32 && lz >= 0 && lz <= 32) {
                return g->data[lx + ly * 33 + lz * 33 * 33];
            }
        }
        return -2000000.0f; // Unique sentinel
    };

    // 1. Try the "next" chunk (the one starting at standard floor/32*32)
    int cx0 = (x >= 0) ? (x / 32) * 32 : ((x - 31) / 32) * 32;
    int cy0 = (y >= 0) ? (y / 32) * 32 : ((y - 31) / 32) * 32;
    int cz0 = (z >= 0) ? (z / 32) * 32 : ((z - 31) / 32) * 32;
    
    float val = trySample(cx0, cy0, cz0);
    if (val > -1500000.0f) return val;

    // 2. If it's a boundary, try the "previous" chunk(s)
    // This is critical for seamless mapping when neighbors aren't initialized
    if ((x % 32) == 0) {
        val = trySample(cx0 - 32, cy0, cz0);
        if (val > -1500000.0f) return val;
    }
    if ((y % 32) == 0) {
        val = trySample(cx0, cy0 - 32, cz0);
        if (val > -1500000.0f) return val;
    }
    if ((z % 32) == 0) {
        val = trySample(cx0, cy0, cz0 - 32);
        if (val > -1500000.0f) return val;
    }

    return -1000000.0f; // Final solid fallback
}

float SDFEngine::getVoxelMat(int x, int y, int z) {
    auto trySample = [&](int cx, int cy, int cz) -> float {
        ChunkGrid* g = getGrid(cx, cy, cz);
        if (g && g->initialized) {
            int lx = x - cx;
            int ly = y - cy;
            int lz = z - cz;
            if (lx >= 0 && lx <= 32 && ly >= 0 && ly <= 32 && lz >= 0 && lz <= 32) {
                return g->mats[lx + ly * 33 + lz * 33 * 33];
            }
        }
        return -1.0f;
    };

    int cx0 = (x >= 0) ? (x / 32) * 32 : ((x - 31) / 32) * 32;
    int cy0 = (y >= 0) ? (y / 32) * 32 : ((y - 31) / 32) * 32;
    int cz0 = (z >= 0) ? (z / 32) * 32 : ((z - 31) / 32) * 32;
    
    float val = trySample(cx0, cy0, cz0);
    if (val >= 0.0f && val <= 10.0f) return val;

    if ((x % 32) == 0) {
        val = trySample(cx0 - 32, cy0, cz0);
        if (val >= 0.0f && val <= 10.0f) return val;
    }
    if ((y % 32) == 0) {
        val = trySample(cx0, cy0 - 32, cz0);
        if (val >= 0.0f && val <= 10.0f) return val;
    }
    if ((z % 32) == 0) {
        val = trySample(cx0, cy0, cz0 - 32);
        if (val >= 0.0f && val <= 10.0f) return val;
    }

    return -1.0f; 
}

inline float opSmoothSubtraction(float d1, float d2, float k) {
    float h = std::max(0.5f - 0.5f * (d2 + d1) / k, 0.0f);
    h = std::min(h, 1.0f);
    return d2 * (1.0f - h) + (-d1) * h + k * h * (1.0f - h);
}

// Master Scene Graph Combiner
vec2 SDFEngine::map(vec3 p, float uLiftY, float uTime) {
    float dBase = sdTerrain(p);
    float baseMat = getTerrainMat(p);
    vec2 res = vec2(dBase, baseMat);

    vec2 bridgeRes = sdBridge(p);
    if (bridgeRes.x < res.x) res = bridgeRes;

    vec2 liftRes = sdLift(p, uLiftY, uTime);
    if (liftRes.x < res.x) res = liftRes;
    
    // Add visual lift effect AFTER structural SDF
    // res.x += uLiftY; // Incorrect - lift already handled in sdLift

    float baseDist = res.x;
    float matID = res.y;

    // Check voxel grids for modifications with robust interpolation
    ChunkGrid* grid = getGrid((int)std::floor(p.x), (int)std::floor(p.y), (int)std::floor(p.z));
    
    if (grid || true) { // Always try to sample if we are close to ANY modified chunk
        int x0 = (int)std::floor(p.x);
        int y0 = (int)std::floor(p.y);
        int z0 = (int)std::floor(p.z);
        
        float fx = p.x - (float)x0;
        float fy = p.y - (float)y0;
        float fz = p.z - (float)z0;
        
        float v000 = getVoxelData(x0, y0, z0);
        float v100 = getVoxelData(x0 + 1, y0, z0);
        float v010 = getVoxelData(x0, y0 + 1, z0);
        float v110 = getVoxelData(x0 + 1, y0 + 1, z0);
        float v001 = getVoxelData(x0, y0, z0 + 1);
        float v101 = getVoxelData(x0 + 1, y0, z0 + 1);
        float v011 = getVoxelData(x0, y0 + 1, z0 + 1);
        float v111 = getVoxelData(x0 + 1, y0 + 1, z0 + 1);
        
        // Only proceed if at least one sample is valid (not the fallback)
        if (v000 > -900000.0f || v100 > -900000.0f || v010 > -900000.0f || v110 > -900000.0f ||
            v001 > -900000.0f || v101 > -900000.0f || v011 > -900000.0f || v111 > -900000.0f) {
            
            float i1 = v000 * (1.0f - fx) + v100 * fx;
            float i2 = v010 * (1.0f - fx) + v110 * fx;
            float i3 = v001 * (1.0f - fx) + v101 * fx;
            float i4 = v011 * (1.0f - fx) + v111 * fx;
            
            float j1 = i1 * (1.0f - fy) + i2 * fy;
            float j2 = i3 * (1.0f - fy) + i4 * fy;
            
            float voxelRes = j1 * (1.0f - fz) + j2 * fz;

            // Union with base (digging logic: positive is empty space)
            if (voxelRes > baseDist) {
                baseDist = voxelRes;
                // Material from the closest voxel
                int mx = (fx < 0.5f) ? x0 : x0 + 1;
                int my = (fy < 0.5f) ? y0 : y0 + 1;
                int mz = (fz < 0.5f) ? z0 : z0 + 1;
                ChunkGrid* mgrid = getGrid(mx, my, mz);
                if (mgrid) {
                    int mlx = mx % 32; if (mlx < 0) mlx += 32;
                    int mly = my % 32; if (mly < 0) mly += 32;
                    int mlz = mz % 32; if (mlz < 0) mlz += 32;
                    matID = mgrid->mats[mlx + mly * 33 + mlz * 33 * 33];
                }
            }
        }
    }

    return vec2(baseDist, matID);
}
