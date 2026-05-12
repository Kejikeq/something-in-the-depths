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
        if (count > 64) count = 64;
        HoleStruct* src = reinterpret_cast<HoleStruct*>(data);
        for (int i = 0; i < count; i++) {
            state.sdfEngine.holes[i] = src[i];
        }
        state.sdfEngine.numHoles = count;
        state.sdfEngine.holeIndex = count % 64;
    }

    void addHole(float x, float y, float z, float r) {
        int idx = state.sdfEngine.holeIndex;
        state.sdfEngine.holes[idx].x = x;
        state.sdfEngine.holes[idx].y = y;
        state.sdfEngine.holes[idx].z = z;
        state.sdfEngine.holes[idx].r = r;
        
        state.sdfEngine.holeIndex = (state.sdfEngine.holeIndex + 1) % 64;
        if (state.sdfEngine.numHoles < 64) {
            state.sdfEngine.numHoles++;
        }
    }

    val doDig(float dirX, float dirY, float dirZ) {
        int oldHoles = state.sdfEngine.numHoles;
        int oldIndex = state.sdfEngine.holeIndex;
        state.tryDig(vec3(dirX, dirY, dirZ));
        if (state.sdfEngine.numHoles > oldHoles || state.sdfEngine.holeIndex != oldIndex) {
            // A hole was added! It's at the previous index
            int addedIndex = oldIndex;
            val obj = val::object();
            obj.set("x", state.sdfEngine.holes[addedIndex].x);
            obj.set("y", state.sdfEngine.holes[addedIndex].y);
            obj.set("z", state.sdfEngine.holes[addedIndex].z);
            obj.set("r", state.sdfEngine.holes[addedIndex].r);
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
        
        std::vector<float> sdf(gridSize * gridSize * gridSize);
        std::vector<float> mat(gridSize * gridSize * gridSize);

        auto getIdx = [&](int x, int y, int z) { return x + y * gridSize + z * gridSize * gridSize; };

        // 1. Опрашиваем SDF-поле для сетки чанка
        for (int z = 0; z < gridSize; z++) {
            for (int y = 0; y < gridSize; y++) {
                for (int x = 0; x < gridSize; x++) {
                    vec3 p(cx + x * SPACING, cy + y * SPACING, cz + z * SPACING);
                    vec2 res = state.sdfEngine.map(p, 0.0f, 0.0f);
                    int idx = getIdx(x, y, z);
                    sdf[idx] = res.x;
                    mat[idx] = res.y;
                }
            }
        }

        std::vector<float> vertices;
        std::vector<float> normals;
        std::vector<float> colors;
        std::vector<uint32_t> indices;

        auto getNormal = [&](vec3 p) {
            float e = 0.01f;
            float nx = state.sdfEngine.map(vec3(p.x+e, p.y, p.z), 0.0f, 0.0f).x - state.sdfEngine.map(vec3(p.x-e, p.y, p.z), 0.0f, 0.0f).x;
            float ny = state.sdfEngine.map(vec3(p.x, p.y+e, p.z), 0.0f, 0.0f).x - state.sdfEngine.map(vec3(p.x, p.y-e, p.z), 0.0f, 0.0f).x;
            float nz = state.sdfEngine.map(vec3(p.x, p.y, p.z+e), 0.0f, 0.0f).x - state.sdfEngine.map(vec3(p.x, p.y, p.z-e), 0.0f, 0.0f).x;
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
                        val[i] = sdf[idx];
                        m[i] = mat[idx];
                        if (val[i] < 0.0f) cubeIndex |= (1 << i);
                    }
                    
                    if (edgeTable[cubeIndex] == 0) continue;
                    
                    int edgeMask = edgeTable[cubeIndex];
                    uint32_t edgeIndices[12];
                    
                    for (int i = 0; i < 12; i++) {
                        if (edgeMask & (1 << i)) {
                            int v0 = edgeVertices[i][0];
                            int v1 = edgeVertices[i][1];
                            
                            int gx0 = x + int(cornerOffsets[v0].x);
                            int gy0 = y + int(cornerOffsets[v0].y);
                            int gz0 = z + int(cornerOffsets[v0].z);
                            
                            int gx1 = x + int(cornerOffsets[v1].x);
                            int gy1 = y + int(cornerOffsets[v1].y);
                            int gz1 = z + int(cornerOffsets[v1].z);
                            
                            uint64_t key1 = (uint64_t)gx0 | ((uint64_t)gy0 << 10) | ((uint64_t)gz0 << 20);
                            uint64_t key2 = (uint64_t)gx1 | ((uint64_t)gy1 << 10) | ((uint64_t)gz1 << 20);
                            uint64_t edgeKey = (key1 < key2) ? (key1 | (key2 << 30)) : (key2 | (key1 << 30));
                            
                            auto it = edgeToVertex.find(edgeKey);
                            if (it != edgeToVertex.end()) {
                                edgeIndices[i] = it->second;
                            } else {
                                float t = val[v0] / (val[v0] - val[v1]);
                                vec3 p0(cx + gx0 * SPACING, cy + gy0 * SPACING, cz + gz0 * SPACING);
                                vec3 p1(cx + gx1 * SPACING, cy + gy1 * SPACING, cz + gz1 * SPACING);
                                vec3 p = p0 + (p1 - p0) * t;
                                
                                vec3 norm = getNormal(p);
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
