#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>
#include <unordered_map>
#include "GameState.h"
#include "MCTables.h"

using namespace emscripten;

struct MeshResult {
    val vertices = val::null();
    val normals = val::null();
    val colors = val::null();
    val indices = val::null();
};

class WasmGameCore {
private:
    GameState state;

public:
    WasmGameCore() {}

    // moveX, moveZ are normalized movement vectors
    void update(float dt, float moveX, float moveZ, bool jump) {
        state.tick(dt, moveX, moveZ, jump);
    }

    void applyJoystickInput(float inputX, float inputY) {
        float sy = std::sin(state.yaw);
        float cy = std::cos(state.yaw);

        // inputY positive means forward. inputX positive means right.
        float moveDirX = sy * inputY - cy * inputX;
        float moveDirZ = cy * inputY + sy * inputX;

        float moveLen = std::sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
        if (moveLen > 1.0f) {
            moveDirX /= moveLen;
            moveDirZ /= moveLen;
        }

        const float MOVE_SPEED = 8.0f;
        state.vel.x = moveDirX * MOVE_SPEED;
        state.vel.z = moveDirZ * MOVE_SPEED;
    }

    val getPlayerState() const {
        val obj = val::object();
        obj.set("x", state.pos.x);
        obj.set("y", state.pos.y);
        obj.set("z", state.pos.z);
        obj.set("yaw", state.yaw);
        obj.set("pitch", state.pitch);
        obj.set("liftY", state.liftY);
        obj.set("gDist", state.gDist);
        return obj;
    }

    // Expose memory pointer directly so JS can wrap a Float32Array around it
    uintptr_t getHolesBuffer() {
        return reinterpret_cast<uintptr_t>(&state.sdfEngine.holes[0]);
    }
    
    int getNumHoles() const {
        return state.sdfEngine.numHoles;
    }
    
    void setCameraOrientation(float yaw, float pitch) {
        state.yaw = yaw;
        state.pitch = pitch;
    }

    void setLiftY(float ly) {
        state.liftY = ly;
    }

    void setPosition(float x, float y, float z, float vy) {
        state.pos.x = x;
        state.pos.y = y;
        state.pos.z = z;
        state.vel.y = vy;
    }

    void clearHoles() {
        state.sdfEngine.numHoles = 0;
        state.sdfEngine.holeIndex = 0;
    }

    void syncHoles(uintptr_t data, int count) {
        if (count > 2048) count = 2048;
        HoleStruct* src = reinterpret_cast<HoleStruct*>(data);
        for (int i = 0; i < count; i++) {
            state.sdfEngine.holes[i] = src[i];
        }
        state.sdfEngine.numHoles = count;
        state.sdfEngine.holeIndex = count % 2048;
    }

    void applyHoleToGrids(float x, float y, float z, float r) {
        // Voxel Grid Baking: Update all affected chunks
        float margin = r + 2.0f;
        int minCX = (int)std::floor((x - margin) / 32.0f) * 32;
        int maxCX = (int)std::floor((x + margin) / 32.0f) * 32;
        int minCY = (int)std::floor((y - margin) / 32.0f) * 32;
        int maxCY = (int)std::floor((y + margin) / 32.0f) * 32;
        int minCZ = (int)std::floor((z - margin) / 32.0f) * 32;
        int maxCZ = (int)std::floor((z + margin) / 32.0f) * 32;

        for (int cx = minCX; cx <= maxCX; cx += 32) {
            for (int cy = minCY; cy <= maxCY; cy += 32) {
                for (int cz = minCZ; cz <= maxCZ; cz += 32) {
                    uint64_t key = state.sdfEngine.getChunkKey(cx, cy, cz);
                    ChunkGrid& grid = state.sdfEngine.voxelGrids[key];
                    
                    if (!grid.initialized) {
                        // Initialize grid from base SDF
                        for (int gz = 0; gz < 33; gz++) {
                            for (int gy = 0; gy < 33; gy++) {
                                for (int gx = 0; gx < 33; gx++) {
                                    vec3 p((float)cx + gx, (float)cy + gy, (float)cz + gz);
                                    vec2 res = state.sdfEngine.map(p, 0.0f, 0.0f);
                                    int gidx = gx + gy * 33 + gz * 33 * 33;
                                    grid.data[gidx] = res.x;
                                    grid.mats[gidx] = res.y;
                                }
                            }
                        }
                        grid.initialized = true;
                    }

                    // Apply the hole to the grid with optimized bounding box
                    int startGX = std::max(0, (int)std::floor(x - r - (float)cx));
                    int endGX = std::min(32, (int)std::ceil(x + r - (float)cx));
                    int startGY = std::max(0, (int)std::floor(y - r - (float)cy));
                    int endGY = std::min(32, (int)std::ceil(y + r - (float)cy));
                    int startGZ = std::max(0, (int)std::floor(z - r - (float)cz));
                    int endGZ = std::min(32, (int)std::ceil(z + r - (float)cz));
                    
                    for (int gz = startGZ; gz <= endGZ; gz++) {
                        for (int gy = startGY; gy <= endGY; gy++) {
                            for (int gx = startGX; gx <= endGX; gx++) {
                                vec3 p((float)cx + gx, (float)cy + gy, (float)cz + gz);
                                float dx = p.x - x;
                                float dy = p.y - y;
                                float dz = p.z - z;
                                float d = std::sqrt(dx*dx + dy*dy + dz*dz) - r;
                                int gidx = gx + gy * 33 + gz * 33 * 33;
                                
                                float holeSDF = -d;
                                if (holeSDF > grid.data[gidx]) {
                                    grid.data[gidx] = holeSDF;
                                    if (grid.mats[gidx] != 0.0f) grid.mats[gidx] += 100.0f;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    void addHole(float x, float y, float z, float r) {
        int idx = state.sdfEngine.holeIndex;
        state.sdfEngine.holes[idx].x = x;
        state.sdfEngine.holes[idx].y = y;
        state.sdfEngine.holes[idx].z = z;
        state.sdfEngine.holes[idx].r = r;
        
        state.sdfEngine.holeIndex = (state.sdfEngine.holeIndex + 1) % 2048;
        if (state.sdfEngine.numHoles < 2048) {
            state.sdfEngine.numHoles++;
        }

        applyHoleToGrids(x, y, z, r);
    }

    val doDig(float dirX, float dirY, float dirZ) {
        int oldIndex = state.sdfEngine.holeIndex;
        state.tryDig(vec3(dirX, dirY, dirZ));
        if (state.sdfEngine.holeIndex != oldIndex) {
            // A hole was added! It's at the previous index
            int addedIndex = oldIndex;
            HoleStruct& h = state.sdfEngine.holes[addedIndex];
            applyHoleToGrids(h.x, h.y, h.z, h.r); // BAKE IT!

            val obj = val::object();
            obj.set("x", h.x);
            obj.set("y", h.y);
            obj.set("z", h.z);
            obj.set("r", h.r);
            return obj;
        }
        return val::null();
    }
    val getSDFValue(float x, float y, float z) {
        vec2 res = state.sdfEngine.map(vec3(x, y, z), 0.0f, 0.0f);
        val obj = val::object();
        obj.set("d", res.x);
        obj.set("m", res.y);
        return obj;
    }

    MeshResult generateChunkMesh(float cx, float cy, float cz, int gridSize) {
        float SPACING = 1.0f;
        
        uint64_t key = state.sdfEngine.getChunkKey((int)cx, (int)cy, (int)cz);
        ChunkGrid& grid = state.sdfEngine.voxelGrids[key];

        if (!grid.initialized) {
            // 1. Initialize from base terrain
            for (int z = 0; z < gridSize; z++) {
                for (int y = 0; y < gridSize; y++) {
                    for (int x = 0; x < gridSize; x++) {
                        vec3 p(cx + x * SPACING, cy + y * SPACING, cz + z * SPACING);
                        vec2 res = state.sdfEngine.map(p, 0.0f, 0.0f);
                        int idx = x + y * gridSize + z * gridSize * gridSize;
                        grid.data[idx] = res.x;
                        grid.mats[idx] = res.y;
                    }
                }
            }
            
            // 2. Apply all historical holes that affect this chunk
            for (int i = 0; i < state.sdfEngine.numHoles; i++) {
                const HoleStruct& h = state.sdfEngine.holes[i];
                float r = h.r;
                float margin = r + 2.0f;
                
                // Chunk bounding box check
                if (h.x + margin < cx || h.x - margin > cx + 32.0f ||
                    h.y + margin < cy || h.y - margin > cy + 32.0f ||
                    h.z + margin < cz || h.z - margin > cz + 32.0f) {
                    continue;
                }
                
                // Bake this hole into the current grid
                int startGX = std::max(0, (int)std::floor(h.x - r - cx));
                int endGX = std::min(32, (int)std::ceil(h.x + r - cx));
                int startGY = std::max(0, (int)std::floor(h.y - r - cy));
                int endGY = std::min(32, (int)std::ceil(h.y + r - cy));
                int startGZ = std::max(0, (int)std::floor(h.z - r - cz));
                int endGZ = std::min(32, (int)std::ceil(h.z + r - cz));
                
                for (int gz = startGZ; gz <= endGZ; gz++) {
                    for (int gy = startGY; gy <= endGY; gy++) {
                        for (int gx = startGX; gx <= endGX; gx++) {
                            vec3 p(cx + (float)gx, cy + (float)gy, cz + (float)gz);
                            float dx = p.x - h.x;
                            float dy = p.y - h.y;
                            float dz = p.z - h.z;
                            float d = std::sqrt(dx*dx + dy*dy + dz*dz) - r;
                            int gidx = gx + gy * 33 + gz * 33 * 33;
                            
                            float holeSDF = -d;
                            if (holeSDF > grid.data[gidx]) {
                                grid.data[gidx] = holeSDF;
                                if (grid.mats[gidx] != 0.0f) grid.mats[gidx] += 100.0f;
                            }
                        }
                    }
                }
            }
            grid.initialized = true;
        }

        std::vector<float> vertices;
        std::vector<float> normals;
        std::vector<float> colors;
        std::vector<uint32_t> indices;

        auto getIdx = [&](int x, int y, int z) { return x + y * gridSize + z * gridSize * gridSize; };

        auto getNormal = [&](int x, int y, int z) {
            float nx = grid.data[getIdx(std::min(x+1, gridSize-1), y, z)] - grid.data[getIdx(std::max(x-1, 0), y, z)];
            float ny = grid.data[getIdx(x, std::min(y+1, gridSize-1), z)] - grid.data[getIdx(x, std::max(y-1, 0), z)];
            float nz = grid.data[getIdx(x, y, std::min(z+1, gridSize-1))] - grid.data[getIdx(x, y, std::max(z-1, 0))];
            float len = std::sqrt(nx*nx + ny*ny + nz*nz);
            if (len > 0.0001f) { nx /= len; ny /= len; nz /= len; }
            return vec3(nx, ny, nz);
        };
        
        auto getColor = [&](float m) {
            if (m == 1.0f) return vec3(0.5f, 0.5f, 0.5f); // rock
            if (m == 2.0f) return vec3(0.8f, 0.8f, 0.5f); // sand
            if (m == 3.0f) return vec3(0.3f, 0.8f, 0.3f); // grass
            if (m == 4.0f) return vec3(0.4f, 0.2f, 0.1f); // wood
            if (m == 5.0f) return vec3(0.8f, 0.8f, 0.8f); // metal
            if (m == 6.0f) return vec3(1.0f, 0.3f, 0.5f); // sakura
            if (m == 7.0f) return vec3(0.8f, 0.9f, 1.0f); // glass/ice
            if (m == 8.0f) return vec3(0.2f, 0.4f, 0.8f); // water
            return vec3(0.5f, 0.5f, 0.5f);
        };

        vec3 cornerOffsets[8] = {
            vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 1, 0), vec3(0, 1, 0),
            vec3(0, 0, 1), vec3(1, 0, 1), vec3(1, 1, 1), vec3(0, 1, 1)
        };
        int edgeVertices[12][2] = {
            {0,1}, {1,2}, {2,3}, {3,0},
            {4,5}, {5,6}, {6,7}, {7,4},
            {0,4}, {1,5}, {2,6}, {3,7}
        };

        std::unordered_map<uint64_t, uint32_t> edgeToVertex;

        // 2. Цикл обхода 3D-пространства чанка (скелет Marching Cubes)
        for (int z = 0; z < gridSize - 1; z++) {
            for (int y = 0; y < gridSize - 1; y++) {
                for (int x = 0; x < gridSize - 1; x++) {
                    float val[8];
                    float m[8];
                    int cubeIndex = 0;
                    for (int i = 0; i < 8; i++) {
                        int idx = getIdx(x + int(cornerOffsets[i].x), y + int(cornerOffsets[i].y), z + int(cornerOffsets[i].z));
                        val[i] = grid.data[idx];
                        m[i] = grid.mats[idx];
                        if (val[i] < 0.0f) cubeIndex |= (1 << i);
                    }
                    
                    if (edgeTable[cubeIndex] == 0) continue;
                    
                    int edgeMask = edgeTable[cubeIndex];
                    uint32_t edgeIndices[12];
                    
                    for (int i = 0; i < 12; i++) {
                        if (edgeMask & (1 << i)) {
                            int v0 = edgeVertices[i][0];
                            int v1 = edgeVertices[i][1];
                            
                            int vx0 = x + int(cornerOffsets[v0].x);
                            int vy0 = y + int(cornerOffsets[v0].y);
                            int vz0 = z + int(cornerOffsets[v0].z);
                            
                            int vx1 = x + int(cornerOffsets[v1].x);
                            int vy1 = y + int(cornerOffsets[v1].y);
                            int vz1 = z + int(cornerOffsets[v1].z);
                            
                            uint64_t key1 = (uint64_t)vx0 | ((uint64_t)vy0 << 10) | ((uint64_t)vz0 << 20);
                            uint64_t key2 = (uint64_t)vx1 | ((uint64_t)vy1 << 10) | ((uint64_t)vz1 << 20);
                            uint64_t edgeKey = (key1 < key2) ? (key1 | (key2 << 30)) : (key2 | (key1 << 30));
                            
                            auto it = edgeToVertex.find(edgeKey);
                            if (it != edgeToVertex.end()) {
                                edgeIndices[i] = it->second;
                            } else {
                                float t = val[v0] / (val[v0] - val[v1]);
                                vec3 p0(cx + vx0 * SPACING, cy + vy0 * SPACING, cz + vz0 * SPACING);
                                vec3 p1(cx + vx1 * SPACING, cy + vy1 * SPACING, cz + vz1 * SPACING);
                                vec3 p = p0 + (p1 - p0) * t;
                                
                                vec3 norm = getNormal(vx0, vy0, vz0); // Simplified normal from grid
                                float matId = (t < 0.5f) ? m[v0] : m[v1];
                                vec3 col = getColor(matId);
                                
                                uint32_t newIdx = vertices.size() / 3;
                                vertices.push_back(p.x);
                                vertices.push_back(p.y);
                                vertices.push_back(p.z);
                                normals.push_back(norm.x);
                                normals.push_back(norm.y);
                                normals.push_back(norm.z);
                                colors.push_back(col.x);
                                colors.push_back(col.y);
                                colors.push_back(col.z);
                                
                                edgeToVertex[edgeKey] = newIdx;
                                edgeIndices[i] = newIdx;
                            }
                        }
                    }
                    
                    for (int i = 0; triTable[cubeIndex][i] != -1; i += 3) {
                        indices.push_back(edgeIndices[triTable[cubeIndex][i]]);
                        indices.push_back(edgeIndices[triTable[cubeIndex][i+1]]);
                        indices.push_back(edgeIndices[triTable[cubeIndex][i+2]]);
                    }
                }
            }
        }

        // Подготавливаем типизированные массивы для возврата в JS
        val jsVertices = val::global("Float32Array").new_(typed_memory_view(vertices.size(), vertices.data()));
        val jsNormals = val::global("Float32Array").new_(typed_memory_view(normals.size(), normals.data()));
        val jsColors = val::global("Float32Array").new_(typed_memory_view(colors.size(), colors.data()));
        val jsIndices = val::global("Uint32Array").new_(typed_memory_view(indices.size(), indices.data()));

        MeshResult result;
        result.vertices = val::global("Float32Array").new_(jsVertices);
        result.normals = val::global("Float32Array").new_(jsNormals);
        result.colors = val::global("Float32Array").new_(jsColors);
        result.indices = val::global("Uint32Array").new_(jsIndices);
        
        return result;
    }
};

EMSCRIPTEN_BINDINGS(my_module) {
    value_object<MeshResult>("MeshResult")
        .field("vertices", &MeshResult::vertices)
        .field("normals", &MeshResult::normals)
        .field("colors", &MeshResult::colors)
        .field("indices", &MeshResult::indices);

    class_<WasmGameCore>("WasmGameCore")
        .constructor<>()
        .function("update", &WasmGameCore::update)
        .function("getPlayerState", &WasmGameCore::getPlayerState)
        .function("applyJoystickInput", &WasmGameCore::applyJoystickInput)
        .function("getHolesBuffer", &WasmGameCore::getHolesBuffer)
        .function("getNumHoles", &WasmGameCore::getNumHoles)
        .function("setCameraOrientation", &WasmGameCore::setCameraOrientation)
        .function("setLiftY", &WasmGameCore::setLiftY)
        .function("setPosition", &WasmGameCore::setPosition)
        .function("clearHoles", &WasmGameCore::clearHoles)
        .function("syncHoles", &WasmGameCore::syncHoles)
        .function("addHole", &WasmGameCore::addHole)
        .function("doDig", &WasmGameCore::doDig)
        .function("getSDFValue", &WasmGameCore::getSDFValue)
        .function("generateChunkMesh", &WasmGameCore::generateChunkMesh);
}
