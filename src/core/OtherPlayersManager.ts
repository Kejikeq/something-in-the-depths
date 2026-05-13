import { PlayerUIData } from '../components/overlay/PlayerOverlays';
import { Player } from './Player';

interface PlayerStateData {
    prevX: number; prevY: number; prevZ: number;
    targetX: number; targetY: number; targetZ: number;
    lerpT: number; speed: number; cycle: number;
}

export class OtherPlayersManager {
    public othersState: Record<string, PlayerStateData> = {};
    public playerMetadata: Record<number, { nickname: string, color: string }> = {};
    public numericIdToIndex = new Map<number, number>();
    
    // Arrays for WASM/WebGL rendering
    public otherPlayersArray = new Float32Array(10 * 4).fill(-1.0);
    public otherColorsArray = new Float32Array(10 * 3).fill(1.0);
    public numOtherPlayers = 0;

    constructor() {}

    syncPlayerColor(idx: number, hex: string) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        this.otherColorsArray[idx * 3] = r;
        this.otherColorsArray[idx * 3 + 1] = g;
        this.otherColorsArray[idx * 3 + 2] = b;
    }

    handleBinaryUpdate(buffer: ArrayBuffer, myNumericId: number) {
        const view = new DataView(buffer);
        const count = view.getUint8(1);
        
        const activeNumericIds = new Set<number>();
        let othersCount = 0;

        for (let i = 0; i < count; i++) {
            const offset = 2 + i * 16;
            const nid = view.getUint32(offset, true);
            const x = view.getFloat32(offset + 4, true);
            const y = view.getFloat32(offset + 8, true);
            const z = view.getFloat32(offset + 12, true);

            if (nid === myNumericId) continue;

            activeNumericIds.add(nid);
            
            let playerIdx = this.numericIdToIndex.get(nid);
            if (playerIdx === undefined) {
                for (let j = 0; j < 10; j++) {
                    let taken = false;
                    for (const val of this.numericIdToIndex.values()) {
                        if (val === j) { taken = true; break; }
                    }
                    if (!taken) {
                        playerIdx = j;
                        this.numericIdToIndex.set(nid, j);
                        break;
                    }
                }
            }

            if (playerIdx !== undefined && playerIdx < 10) {
                othersCount++;
                const nidStr = nid.toString();
                const existing = this.othersState[nidStr];
                
                const meta = this.playerMetadata[nid];
                if (meta) {
                    this.syncPlayerColor(playerIdx, meta.color);
                }

                if (!existing) {
                    this.othersState[nidStr] = {
                        prevX: x, prevY: y, prevZ: z,
                        targetX: x, targetY: y, targetZ: z,
                        lerpT: 1.0, speed: 0, cycle: 0
                    };
                    const bIdx = playerIdx * 4;
                    this.otherPlayersArray[bIdx] = x;
                    this.otherPlayersArray[bIdx + 1] = y;
                    this.otherPlayersArray[bIdx + 2] = z;
                    this.otherPlayersArray[bIdx + 3] = 0.0;
                } else {
                    const t = Math.min(1.0, existing.lerpT);
                    const curX = existing.prevX + (existing.targetX - existing.prevX) * t;
                    const curY = existing.prevY + (existing.targetY - existing.prevY) * t;
                    const curZ = existing.prevZ + (existing.targetZ - existing.prevZ) * t;
                    
                    const dx = x - existing.targetX;
                    const dz = z - existing.targetZ;
                    const dist = Math.sqrt(dx*dx + dz*dz);
                    const newSpeed = dist > 0.01 ? 1.0 : 0.0;
                    
                    existing.prevX = curX;
                    existing.prevY = curY;
                    existing.prevZ = curZ;
                    existing.targetX = x;
                    existing.targetY = y;
                    existing.targetZ = z;
                    existing.lerpT = 0;
                    existing.speed = newSpeed;
                }
            }
        }

        this.numOtherPlayers = othersCount;

        for (const [nid, idx] of this.numericIdToIndex.entries()) {
            if (!activeNumericIds.has(nid)) {
                this.numericIdToIndex.delete(nid);
                delete this.othersState[nid.toString()];
                this.otherPlayersArray[idx * 4 + 3] = -1.0;
            }
        }
    }

    interpolateAndProject(dt: number, interpSpeed: number, player: Player, cameraVectors: {fwd: any, right: any, up: any}): PlayerUIData[] {
        const newPlayerUI: PlayerUIData[] = [];
        const { fwd, right, up } = cameraVectors;

        for (const nidStr in this.othersState) {
            const state = this.othersState[nidStr];
            const nid = parseInt(nidStr);
            const idx = this.numericIdToIndex.get(nid);
            
            if (idx !== undefined && idx < 10) {
                state.lerpT = Math.min(1.0, state.lerpT + dt * interpSpeed);
                const t = state.lerpT;
                const x = state.prevX + (state.targetX - state.prevX) * t;
                const y = state.prevY + (state.targetY - state.prevY) * t;
                const z = state.prevZ + (state.targetZ - state.prevZ) * t;
                
                const baseIdx = idx * 4;
                this.otherPlayersArray[baseIdx] = x;
                this.otherPlayersArray[baseIdx + 1] = y;
                this.otherPlayersArray[baseIdx + 2] = z;
                
                const curVisualSpeed = this.otherPlayersArray[baseIdx + 3];
                this.otherPlayersArray[baseIdx + 3] = curVisualSpeed * (1.0 - Math.min(1.0, dt * 10.0)) + state.speed * Math.min(1.0, dt * 10.0);

                const meta = this.playerMetadata[nid];
                if (meta) {
                    const tagPos = { x, y: y + 0.5, z };
                    const rel = { 
                        x: tagPos.x - player.pos.x, 
                        y: tagPos.y - player.pos.y, 
                        z: tagPos.z - player.pos.z 
                    };
                    
                    const viewZ = rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z;
                    const viewX = rel.x * right.x + rel.y * right.y + rel.z * right.z;
                    const viewY = rel.x * up.x + rel.y * up.y + rel.z * up.z;
                    
                    const dist = Math.sqrt(rel.x*rel.x + rel.y*rel.y + rel.z*rel.z);
                    
                    const fov = 1.0; 
                    const screenX = (viewX / (viewZ * fov)) * 0.5 + 0.5;
                    const screenY = 0.5 - (viewY / (viewZ * fov)) * 0.5;

                    const offScreen = viewZ <= 0.1 || screenX < 0.05 || screenX > 0.95 || screenY < 0.05 || screenY > 0.95;
                    const angle = Math.atan2(viewX, -viewY);

                    newPlayerUI.push({
                        nid,
                        nickname: meta.nickname,
                        color: meta.color,
                        screenX: screenX * 100,
                        screenY: screenY * 100,
                        visible: true,
                        dist,
                        offScreen,
                        angle
                    });
                }
            }
        }
        return newPlayerUI;
    }
}
