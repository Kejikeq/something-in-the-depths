export default async function initWasmModule(config) {
    console.warn("WASM not compiled inside the container. Falling back to TypeScript JS engine...");
    
    const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: 256 });

    class WasmGameCore {
        constructor() {
            this.x = 0.0;
            this.y = 1.5;
            this.z = 66.0;
            this.vy = 0;
            this.yaw = 0;
            this.pitch = 0;
            this.liftY = 0;
            
            this.holesCount = 0;
            this.holeIndex = 0;

            this.holesArray = new Float32Array(wasmMemory.buffer, 0, 256);
        }
        
        update(dt, bitmask, jump) {
            let moveDirX = 0, moveDirZ = 0;
            const isW = (bitmask & 1) !== 0;
            const isA = (bitmask & 2) !== 0;
            const isS = (bitmask & 4) !== 0;
            const isD = (bitmask & 8) !== 0;
            
            const cy = Math.cos(this.yaw);
            const sy = Math.sin(this.yaw);
            if (isW) { moveDirX += sy; moveDirZ += cy; }
            if (isS) { moveDirX -= sy; moveDirZ -= cy; }
            if (isA) { moveDirX -= cy; moveDirZ += sy; }
            if (isD) { moveDirX += cy; moveDirZ -= sy; }
            
            const moveLen = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
            if (moveLen > 0.01) {
                moveDirX /= moveLen;
                moveDirZ /= moveLen;
            }
            const moveSpeed = 8.0;
            this.x += moveDirX * moveSpeed * dt;
            this.z += moveDirZ * moveSpeed * dt;
            
            let currentLayer = -499.2;
            if (this.y > -40.0) currentLayer = 0.0;
            else if (this.y > -175.0) currentLayer = -115.0;
            else if (this.y > -295.0) currentLayer = -235.0;
            else if (this.y > -390.0) currentLayer = -355.0;
            else currentLayer = -440.0;

            let inHole = false;
            for (let i = 0; i < this.holesCount; i++) {
                const hx = this.holesArray[i * 4];
                const hy = this.holesArray[i * 4 + 1];
                const hz = this.holesArray[i * 4 + 2];
                const hr = this.holesArray[i * 4 + 3];
                if (Math.abs(hy - currentLayer) < 2.0) {
                    const dx = this.x - hx;
                    const dz = this.z - hz;
                    if (Math.sqrt(dx*dx + dz*dz) < hr - 0.1) {
                        inHole = true;
                        break;
                    }
                }
            }

            const distFromCenter = Math.sqrt(this.x * this.x + this.z * this.z);
            let inAbyss = distFromCenter < 28.0;

            const onLift = (Math.abs(this.x - 0.0) < 2.2 && Math.abs(this.z - 2.5) < 2.2);
            // Bridge extends from z=4.7 to 29.0
            const onBridge = (Math.abs(this.x) <= 1.5 && this.z >= 4.7 && this.z <= 29.0);

            let floorY = -499.2;
            if (onLift) {
                floorY = -0.4 + this.liftY + 0.12;
            } else if (onBridge && this.y >= -1.5) {
                floorY = -0.3; 
            } else {
                if (inAbyss) {
                    floorY = -499.2;
                } else if (inHole) {
                    if (currentLayer >= 0.0) floorY = -115.0;
                    else if (currentLayer >= -115.0) floorY = -235.0;
                    else if (currentLayer >= -235.0) floorY = -355.0;
                    else if (currentLayer >= -355.0) floorY = -440.0;
                    else floorY = -499.2;
                } else {
                    floorY = currentLayer;
                }
            }

            const groundY = floorY + 1.4; // 1.4 is PLAYER_HEIGHT
            
            if (jump && this.y - groundY < 0.1 && this.vy <= 0.1) {
               this.vy = 6.5; 
            }
            this.vy += -15.0 * dt;
            this.y += this.vy * dt;
            
            if (this.y < groundY && this.vy <= 0) {
               this.y = groundY;
               this.vy = 0;
            }
            
            if (this.y < -500.0) {
               this.x = 0.0;
               this.y = 1.5;
               this.z = 66.0;
               this.vy = 0.0;
            }
        }
        
        getPlayerState() {
            return { x: this.x, y: this.y, z: this.z, vy: this.vy };
        }
        
        getHolesBuffer() {
            return 0; 
        }
        
        getNumHoles() {
            return this.holesCount;
        }
        
        setCameraOrientation(yaw, pitch) {
            this.yaw = yaw;
            this.pitch = pitch;
        }
        
        setLiftY(y) {
            this.liftY = y;
        }
        
        setPosition(x, y, z, vy) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.vy = vy;
        }
        
        clearHoles() {
            this.holesCount = 0;
            this.holeIndex = 0;
            this.holesArray.fill(0);
        }
        
        syncHoles(ptr, count) {
            if (count > 64) count = 64;
            const src = new Float32Array(wasmMemory.buffer, ptr, count * 4);
            this.holesArray.set(src, 0);
            this.holesCount = count;
            this.holeIndex = count % 64;
        }

        addHole(x, y, z, r) {
            const idx = this.holeIndex * 4;
            this.holesArray[idx] = x;
            this.holesArray[idx + 1] = y;
            this.holesArray[idx + 2] = z;
            this.holesArray[idx + 3] = r;
            
            this.holeIndex = (this.holeIndex + 1) % 64;
            if (this.holesCount < 64) {
                this.holesCount++;
            }
        }
        
        doDig(dirX, dirY, dirZ) {
            const hx = this.x + dirX * 2.5;
            const hy = this.y + dirY * 2.5;
            const hz = this.z + dirZ * 2.5;
            const hr = 1.3;
            
            this.addHole(hx, hy, hz, hr);
            return { x: hx, y: hy, z: hz, r: hr };
        }
        
        delete() {}
    }
    
    return {
        WasmGameCore: WasmGameCore,
        wasmMemory: wasmMemory
    };
}
