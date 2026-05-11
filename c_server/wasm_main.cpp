#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "GameState.h"

using namespace emscripten;

class WasmGameCore {
private:
    GameState state;

public:
    WasmGameCore() {}

    // bitmask: 0=W, 1=A, 2=S, 3=D
    void update(float dt, int bitmask, bool jump) {
        bool keys[4] = {
            (bitmask & 1) != 0,
            (bitmask & 2) != 0,
            (bitmask & 4) != 0,
            (bitmask & 8) != 0
        };
        state.tick(dt, keys, jump);
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
};

EMSCRIPTEN_BINDINGS(my_module) {
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
        .function("doDig", &WasmGameCore::doDig);
}
