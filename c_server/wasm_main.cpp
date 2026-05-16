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
            // Apply each hole to the voxel system
            state.sdfEngine.digVoxel(vec3(src[i].x, src[i].y, src[i].z), src[i].r);
        }
        state.sdfEngine.numHoles = count;
        state.sdfEngine.holeIndex = count % 2048;
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

        state.sdfEngine.digVoxel(vec3(x, y, z), r);
    }

    val doDig(float dirX, float dirY, float dirZ) {
        int oldIndex = state.sdfEngine.holeIndex;
        state.tryDig(vec3(dirX, dirY, dirZ));
        if (state.sdfEngine.holeIndex != oldIndex) {
            int addedIndex = oldIndex;
            HoleStruct& h = state.sdfEngine.holes[addedIndex];
            // Voxel dig is already called inside state.tryDig -> sdfEngine.digVoxel
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
        vec2 res = state.sdfEngine.map(vec3(x, y, z), state.liftY, 0.0f);
        val obj = val::object();
        obj.set("d", res.x);
        obj.set("m", res.y);
        return obj;
    }

    MeshResult generateChunkMesh(float cx, float cy, float cz, int gridSize, int lod) {
        float SPACING = (float)(1 << lod); 
        
        // Use a padded local buffer to compute smooth normals and avoid under-generation holes
        int paddedSize = gridSize + 2;
        std::vector<float> lodData(paddedSize * paddedSize * paddedSize);
        std::vector<float> lodMats(paddedSize * paddedSize * paddedSize);

        for (int z = 0; z < paddedSize; z++) {
            for (int y = 0; y < paddedSize; y++) {
                for (int x = 0; x < paddedSize; x++) {
                    int vx = x - 1;
                    int vy = y - 1;
                    int vz = z - 1;
                    int px = (int)cx + vx * (int)SPACING;
                    int py = (int)cy + vy * (int)SPACING;
                    int pz = (int)cz + vz * (int)SPACING;
                    
                    float d = state.sdfEngine.getVoxelData(px, py, pz);
                    float m = 1.0f; // Default grass
                    
                    if (d < -999999.0f) {
                        vec3 p((float)px, (float)py, (float)pz);
                        d = state.sdfEngine.sdTerrain(p);
                        m = state.sdfEngine.getTerrainMat(p);
                    } else {
                        m = state.sdfEngine.getVoxelMat(px, py, pz);
                        if (m < 0.0f) {
                            vec3 p((float)px, (float)py, (float)pz);
                            m = state.sdfEngine.getTerrainMat(p);
                        }
                    }
                    
                    int idx = x + y * paddedSize + z * paddedSize * paddedSize;
                    lodData[idx] = d;
                    lodMats[idx] = m;
                }
            }
        }

        std::vector<float> vertices;
        std::vector<float> normals;
        std::vector<float> colors;
        std::vector<uint32_t> indices;

        auto getSIdx = [&](int x, int y, int z) { 
            return (x + 1) + (y + 1) * paddedSize + (z + 1) * paddedSize * paddedSize; 
        };
        
        auto getColor = [&](float m) {
            return vec3(m, 0.0f, 0.0f); // Pass material ID in the R component
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

        for (int z = 0; z < gridSize - 1; z++) {
            for (int y = 0; y < gridSize - 1; y++) {
                for (int x = 0; x < gridSize - 1; x++) {
                    float val[8];
                    float m[8];
                    int cubeIndex = 0;
                    for (int i = 0; i < 8; i++) {
                        int idx = getSIdx(x + int(cornerOffsets[i].x), y + int(cornerOffsets[i].y), z + int(cornerOffsets[i].z));
                        val[i] = lodData[idx];
                        m[i] = lodMats[idx];
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
                                
                                // Accurate normal using padded SDF access
                                float nx = lodData[getSIdx(vx0+1, vy0, vz0)] - lodData[getSIdx(vx0-1, vy0, vz0)];
                                float ny = lodData[getSIdx(vx0, vy0+1, vz0)] - lodData[getSIdx(vx0, vy0-1, vz0)];
                                float nz = lodData[getSIdx(vx0, vy0, vz0+1)] - lodData[getSIdx(vx0, vy0, vz0-1)];

                                vec3 norm(nx, ny, nz);
                                float nLen = std::sqrt(nx*nx + ny*ny + nz*nz);
                                if (nLen > 0.0001f) { norm.x /= nLen; norm.y /= nLen; norm.z /= nLen; }
                                else { norm = vec3(0, 1, 0); }
                                
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

        // Подготавливаем типизированные массивы для возврата в JS (обязательное копирование через slice)
        val jsVertices = vertices.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(vertices.size(), vertices.data())).call<val>("slice");
        val jsNormals = normals.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(normals.size(), normals.data())).call<val>("slice");
        
        // Квантуем материалы до целых чисел 1-8
        for (size_t i = 0; i < colors.size(); i += 3) {
            float m = colors[i];
            float finalM = std::max(1.0f, std::min(8.0f, std::floor(m + 0.5f)));
            colors[i] = finalM;
            colors[i+1] = finalM;
            colors[i+2] = finalM;
        }
        val jsColors = colors.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(colors.size(), colors.data())).call<val>("slice");
        val jsIndices = indices.empty() ? val::global("Uint32Array").new_(0) : val::global("Uint32Array").new_(typed_memory_view(indices.size(), indices.data())).call<val>("slice");

        MeshResult result;
        result.vertices = jsVertices;
        result.normals = jsNormals;
        result.colors = jsColors;
        result.indices = jsIndices;
        
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
