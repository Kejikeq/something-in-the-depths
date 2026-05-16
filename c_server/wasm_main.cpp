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
    val billboards = val::null();
};

class WasmGameCore {
private:
    GameState state;

    float worldHash(float x, float y, float z) {
        float h = std::sin(x * 12.9898f + y * 78.233f + z * 37.719f) * 43758.5453f;
        return h - std::floor(h);
    }

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
        state.sdfEngine.numHoles = 0; // Reset before syncing
        for (int i = 0; i < count; i++) {
            state.sdfEngine.addHoleInternal(src[i].x, src[i].y, src[i].z, src[i].r);
        }
    }

    void addHole(float x, float y, float z, float r) {
        state.sdfEngine.addHoleInternal(x, y, z, r);
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
        
        int paddedSize = gridSize + 2;
        std::vector<float> lodData(paddedSize * paddedSize * paddedSize);
        std::vector<float> lodMats(paddedSize * paddedSize * paddedSize);
        std::vector<float> lodDark(paddedSize * paddedSize * paddedSize);

        for (int z = 0; z < paddedSize; z++) {
            for (int y = 0; y < paddedSize; y++) {
                for (int x = 0; x < paddedSize; x++) {
                    int vx = x - 1; int vy = y - 1; int vz = z - 1;
                    float px = cx + (float)vx * SPACING;
                    float py = cy + (float)vy * SPACING;
                    float pz = cz + (float)vz * SPACING;
                    vec3 p(px, py, pz);
                    
                    float d = state.sdfEngine.getVoxelData((int)px, (int)py, (int)pz);
                    float m = 1.0f;
                    
                    if (d < -999999.0f) {
                        d = state.sdfEngine.sdTerrain(p);
                        m = state.sdfEngine.getTerrainMat(p);
                    } else {
                        m = state.sdfEngine.getVoxelMat((int)px, (int)py, (int)pz);
                        if (m < 0.0f) m = state.sdfEngine.getTerrainMat(p);
                    }

                    // Apply holes to density
                    float hDist = state.sdfEngine.getDistance(p);
                    if (hDist > -10.0f) {
                        if (hDist > d) d = hDist;
                    }

                    // Compute AO (Darkness)
                    float darkness = 0.0f;
                    if (py < 0.0f) {
                        float depth = std::abs(py);
                        if (depth < 20.0f) darkness = depth / 20.0f;
                        else darkness = 1.0f;
                        // Lighten up near holes
                        if (hDist > -4.0f) {
                            float holeFactor = std::max(0.0f, std::min(1.0f, (hDist + 4.0f) / 4.0f));
                            darkness *= (1.0f - holeFactor * 0.8f);
                        }
                    }

                    int idx = x + y * paddedSize + z * paddedSize * paddedSize;
                    lodData[idx] = d;
                    lodMats[idx] = m;
                    lodDark[idx] = darkness;
                }
            }
        }

        std::vector<float> vertices;
        std::vector<float> normals;
        std::vector<float> colors;
        std::vector<uint32_t> indices;
        std::vector<float> billboards;

        auto getSIdx = [&](int x, int y, int z) { 
            return (x + 1) + (y + 1) * paddedSize + (z + 1) * paddedSize * paddedSize; 
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
                    float val[8]; float m[8]; float d[8];
                    int cubeIndex = 0;
                    for (int i = 0; i < 8; i++) {
                        int idx = getSIdx(x + int(cornerOffsets[i].x), y + int(cornerOffsets[i].y), z + int(cornerOffsets[i].z));
                        val[i] = lodData[idx];
                        m[i] = lodMats[idx];
                        d[i] = lodDark[idx];
                        if (val[i] < 0.0f) cubeIndex |= (1 << i);
                    }

                    // Billboard generation (only LOD 0)
                    if (lod == 0 && cubeIndex != 0 && cubeIndex != 255) {
                        float baseM = m[0];
                        if (baseM >= 0.8f && baseM <= 1.5f) {
                            float wx = cx + (float)x * SPACING;
                            float wy = cy + (float)y * SPACING;
                            float wz = cz + (float)z * SPACING;
                            float h = worldHash(wx, wy, wz);
                            float densH = worldHash(std::floor(wx * 0.1f), 0, std::floor(wz * 0.1f)) * 0.5f +
                                          worldHash(std::floor(wx * 0.03f), 1, std::floor(wz * 0.03f)) * 0.5f;
                            float threshold = 0.55f + densH * 0.4f;
                            if (h > threshold) {
                                float centerD = lodData[getSIdx(x, y, z)];
                                float upD = lodData[getSIdx(x, y+1, z)];
                                if (centerD < 0.0f && upD >= 0.0f) {
                                    float t = centerD / (centerD - upD);
                                    float jitterX = (worldHash(wx + 7, wy, wz) - 0.5f) * SPACING * 0.9f;
                                    float jitterZ = (worldHash(wx, wy, wz + 13) - 0.5f) * SPACING * 0.9f;
                                    float type = (h > 0.985f) ? (0.7f + std::floor(worldHash(wx * 1.5f, wy, wz * 1.5f) * 3.0f) * 0.1f)
                                                              : (std::floor(worldHash(wx * 0.5f, wy, wz * 0.5f) * 3.0f) * 0.1f);
                                    billboards.push_back(wx + jitterX);
                                    billboards.push_back(cy + ((float)y + t) * SPACING - 1.1f);
                                    billboards.push_back(wz + jitterZ);
                                    billboards.push_back(type);
                                }
                            }
                        }
                    }
                    
                    if (edgeTable[cubeIndex] == 0) continue;
                    
                    int edgeMask = edgeTable[cubeIndex];
                    uint32_t edgeIndices[12];
                    
                    for (int i = 0; i < 12; i++) {
                        if (edgeMask & (1 << i)) {
                            int v0 = edgeVertices[i][0]; int v1 = edgeVertices[i][1];
                            int vx0 = x + int(cornerOffsets[v0].x); int vy0 = y + int(cornerOffsets[v0].y); int vz0 = z + int(cornerOffsets[v0].z);
                            int vx1 = x + int(cornerOffsets[v1].x); int vy1 = y + int(cornerOffsets[v1].y); int vz1 = z + int(cornerOffsets[v1].z);
                            
                            uint64_t key1 = (uint64_t)vx0 | ((uint64_t)vy0 << 10) | ((uint64_t)vz0 << 20);
                            uint64_t key2 = (uint64_t)vx1 | ((uint64_t)vy1 << 10) | ((uint64_t)vz1 << 20);
                            uint64_t edgeKey = (key1 < key2) ? (key1 | (key2 << 30)) : (key2 | (key1 << 30));
                            
                            auto it = edgeToVertex.find(edgeKey);
                            if (it != edgeToVertex.end()) {
                                edgeIndices[i] = it->second;
                            } else {
                                float t = val[v0] / (val[v0] - val[v1]);
                                vec3 p0(cx + (float)vx0 * SPACING, cy + (float)vy0 * SPACING, cz + (float)vz0 * SPACING);
                                vec3 p1(cx + (float)vx1 * SPACING, cy + (float)vy1 * SPACING, cz + (float)vz1 * SPACING);
                                vec3 p = p0 + (p1 - p0) * t;
                                
                                float nx = lodData[getSIdx(vx0+1, vy0, vz0)] - lodData[getSIdx(vx0-1, vy0, vz0)];
                                float ny = lodData[getSIdx(vx0, vy0+1, vz0)] - lodData[getSIdx(vx0, vy0-1, vz0)];
                                float nz = lodData[getSIdx(vx0, vy0, vz0+1)] - lodData[getSIdx(vx0, vy0-1, vz0)];
                                vec3 norm(nx, ny, nz);
                                float nLen = std::sqrt(nx*nx + ny*ny + nz*nz);
                                if (nLen > 0.0001f) { norm.x /= nLen; norm.y /= nLen; norm.z /= nLen; }
                                else { norm = vec3(0, 1, 0); }
                                
                                float matId = m[v0] + (m[v1] - m[v0]) * t;
                                float darkId = d[v0] + (d[v1] - d[v0]) * t;
                                float finalM = matId;
                                if (finalM >= 0.8f && finalM <= 1.2f) {
                                    float steep = std::max(0.0f, std::min(1.0f, (0.85f - norm.y) * 5.0f));
                                    finalM = matId * (1.0f - steep) + 3.0f * steep;
                                }
                                
                                uint32_t newIdx = vertices.size() / 3;
                                vertices.push_back(p.x); vertices.push_back(p.y); vertices.push_back(p.z);
                                normals.push_back(norm.x); normals.push_back(norm.y); normals.push_back(norm.z);
                                colors.push_back(finalM); colors.push_back(darkId); colors.push_back(0.0f);
                                
                                edgeToVertex[edgeKey] = newIdx;
                                edgeIndices[i] = newIdx;
                            }
                        }
                    }
                    
                    for (int i = 0; triTable[cubeIndex][i] != -1; i += 3) {
                        indices.push_back(edgeIndices[triTable[cubeIndex][i]]);
                        indices.push_back(edgeIndices[triTable[cubeIndex][i+2]]);
                        indices.push_back(edgeIndices[triTable[cubeIndex][i+1]]);
                    }
                }
            }
        }

        val jsVertices = vertices.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(vertices.size(), vertices.data())).call<val>("slice");
        val jsNormals = normals.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(normals.size(), normals.data())).call<val>("slice");
        val jsColors = colors.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(colors.size(), colors.data())).call<val>("slice");
        val jsIndices = indices.empty() ? val::global("Uint32Array").new_(0) : val::global("Uint32Array").new_(typed_memory_view(indices.size(), indices.data())).call<val>("slice");
        val jsBillboards = billboards.empty() ? val::global("Float32Array").new_(0) : val::global("Float32Array").new_(typed_memory_view(billboards.size(), billboards.data())).call<val>("slice");

        MeshResult result;
        result.vertices = jsVertices;
        result.normals = jsNormals;
        result.colors = jsColors;
        result.indices = jsIndices;
        result.billboards = jsBillboards;
        
        return result;
    }
};

EMSCRIPTEN_BINDINGS(my_module) {
    value_object<MeshResult>("MeshResult")
        .field("vertices", &MeshResult::vertices)
        .field("normals", &MeshResult::normals)
        .field("colors", &MeshResult::colors)
        .field("indices", &MeshResult::indices)
        .field("billboards", &MeshResult::billboards);

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
