/**
 * VoxelEngine.ts
 * Unified core for SDF logic, Physics, and Marching Cubes data.
 */

// --- MATH HELPERS ---

export class vec2 {
    constructor(public x: number = 0, public y: number = 0) {}
}

export class vec3 {
    constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}
    add(v: vec3) { return new vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v: vec3) { return new vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
    mul(s: number) { return new vec3(this.x * s, this.y * s, this.z * s); }
}

export function dot(a: vec3, b: vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function length3(v: vec3) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
export function length2(v: vec2) { return Math.sqrt(v.x * v.x + v.y * v.y); }
export function clamp_f(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(v, hi)); }

// --- CONFIGURATION ---

export const WORLD_CONFIG = {
    ABYSS_RADIUS: 28.0,
    TREE_SCALE: 2.5,
    GRAVITY: -15.0,
    MOVE_SPEED: 8.0,
    JUMP_STRENGTH: 6.5,
    LIFT_SPEED: 5.0,
    PLAYER_HEIGHT: 1.4,
    COLLISION_RADIUS: 0.35,
    MAX_HOLES: 2048,
    COLORS: {
        DAY_SKY: 'vec3(0.3, 0.55, 0.95)',
        DAY_HORIZON: 'vec3(0.6, 0.8, 1.0)',
        ABYSS_BG: 'vec3(0.01, 0.02, 0.05)',
    },
    SHADERS: {
        vertex: `
        attribute vec2 position;
        varying vec2 vUv;
        void main() {
            vUv = position * 0.5 + 0.5;
            gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
        postProcess: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene;
        uniform vec2 uResolution;
        uniform int uPerfMode;
    
        void main() {
            vec2 texel = 1.0 / uResolution;
            vec4 sceneVal = texture2D(uScene, vUv);
            vec3 col = sceneVal.rgb;
            
            // Basic gamma correction for better visibility
            col = pow(col, vec3(0.8));
            
            gl_FragColor = vec4(col, 1.0);
        }
      `
    }
};

import { edgeTable, triTable } from './VoxelTables';

// --- VOXEL & SDF LOGIC ---

export class VoxelEngine {
    private static OUT = new Float32Array(2);

    static sinNoise(v: {x: number, y: number, z: number}, scale: number = 1.0): number {
        const px = v.x * scale; const py = v.y * scale; const pz = v.z * scale;
        let n = Math.sin(px) * Math.sin(py) * Math.sin(pz);
        n += 0.5 * Math.sin(px * 2.1 + 1.2) * Math.sin(py * 2.1 + 3.4) * Math.sin(pz * 2.1 + 5.6);
        return n;
    }

    static sdCylinder(p: vec3, r: number, h: number): number {
        const dx = Math.sqrt(p.x * p.x + p.z * p.z) - r;
        const dy = Math.abs(p.y) - h;
        return Math.min(Math.max(dx, dy), 0.0) + Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2);
    }

    static sdBox(p: vec3, b: vec3): number {
        const dx = Math.abs(p.x) - b.x;
        const dy = Math.abs(p.y) - b.y;
        const dz = Math.abs(p.z) - b.z;
        return Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 + Math.max(dz, 0) ** 2) + Math.min(Math.max(dx, Math.max(dy, dz)), 0.0);
    }

    static sdTerrain(p: vec3): number {
        let d = p.y;
        const dEntrance = Math.sqrt(p.x * p.x + p.z * p.z) - WORLD_CONFIG.ABYSS_RADIUS;
        const jaggedWalls = dEntrance + this.sinNoise(p, 0.5) * 1.5;
        d = Math.max(d, -Math.max(jaggedWalls, -p.y - 150.0));

        if (p.y <= 0.0) {
            let dTunnel = 1000.0;
            for (let i = 1; i <= 3; i++) {
                const seed = i * 1.57;
                const pxz_x = Math.sin(p.y * 0.05 + seed) * 15.0 + Math.cos(p.y * 0.02) * 5.0;
                const pxz_z = Math.cos(p.y * 0.04 - seed) * 12.0 + Math.sin(p.y * 0.01) * 8.0;
                const tube = Math.sqrt((p.x - pxz_x) ** 2 + (p.z - pxz_z) ** 2) - (2.2 + this.sinNoise(p, 0.3) * 1.2);
                dTunnel = Math.min(dTunnel, tube);
            }
            d = Math.max(d, -dTunnel);
        }

        if (p.y > -10.0) {
            const dWall = Math.max(Math.abs(Math.sqrt(p.x * p.x + p.z * p.z) - 100.0) - 1.25, Math.abs(p.y - 12.5) - 12.5);
            if (dWall < d) d = dWall;
        }
        return d;
    }

    static getDistance(p: vec3, liftY: number, holes: Float32Array, numHoles: number): number {
        let d = this.sdTerrain(p);

        // 1. Lift
        const liftDist = this.sdBox(new vec3(p.x, p.y + 0.4 - liftY, p.z - 2.5), new vec3(2.7, 0.12, 2.7));
        d = Math.min(d, liftDist);

        // 2. Bridge
        const bridgeDist = this.sdBox(new vec3(p.x, p.y + 0.4, p.z - 16.85), new vec3(1.5, 0.1, 12.15));
        const fenceL = this.sdBox(new vec3(p.x - 1.4, p.y, p.z - 16.85), new vec3(0.08, 0.8, 12.15));
        const fenceR = this.sdBox(new vec3(p.x + 1.4, p.y, p.z - 16.85), new vec3(0.08, 0.8, 12.15));
        d = Math.min(d, bridgeDist, fenceL, fenceR);

        // 3. Pier
        const pierDist = this.sdBox(new vec3(p.x, p.y + 0.4, p.z - 55.0), new vec3(2.5, 0.15, 15.0));
        d = Math.min(d, pierDist);

        // 4. Tree (Approximate for collision)
        const tpX = p.x - 34.0, tpY = p.y + 1.0, tpZ = p.z + 8.0;
        const trunkX = tpX - Math.sin(tpY * 0.2) * 1.2;
        const treeTrunk = Math.max(Math.sqrt(trunkX * trunkX + tpZ * tpZ) - 0.4, Math.abs(tpY - 4.0) - 4.0);
        d = Math.min(d, treeTrunk);

        // 5. Sign
        const signBox = this.sdBox(new vec3(p.x + 3.0, p.y, p.z - 28.0), new vec3(0.6, 1.2, 0.6));
        const signDist = Math.max(signBox, -p.y - 1.0);
        d = Math.min(d, signDist);

        // 6. Mirror
        const mirrorDist = this.sdBox(new vec3(p.x, p.y - 1.5, p.z - 24.0), new vec3(4.0, 2.5, 0.6));
        d = Math.min(d, mirrorDist);

        // 7. Digging Holes
        if (numHoles > 0) {
            let minHoleDist = 1000.0;
            let first = true;
            for (let i = 0; i < numHoles; i++) {
                const dx = p.x - holes[i * 4]; const dy = p.y - holes[i * 4 + 1]; const dz = p.z - holes[i * 4 + 2];
                const hr = holes[i * 4 + 3];
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - hr;
                if (first) { minHoleDist = dist; first = false; }
                else { minHoleDist = Math.min(minHoleDist, dist); }
            }
            if (minHoleDist < 30.0) {
                d = Math.max(d, -minHoleDist);
            }
        }

        return Math.fround(d * 0.65);
    }

    static getNormal(p: vec3, liftY: number, holes: Float32Array, numHoles: number): vec3 {
        const eps = 0.01;
        const d = this.getDistance(p, liftY, holes, numHoles);
        const nx = this.getDistance(new vec3(p.x + eps, p.y, p.z), liftY, holes, numHoles) - d;
        const ny = this.getDistance(new vec3(p.x, p.y + eps, p.z), liftY, holes, numHoles) - d;
        const nz = this.getDistance(new vec3(p.x, p.y, p.z + eps), liftY, holes, numHoles) - d;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len < 0.0001) return new vec3(0, 1, 0);
        return new vec3(nx/len, ny/len, nz/len);
    }

    // --- PHYSICS ENGINE ---

    static tickPhysics(pos: vec3, vel: vec3, dt: number, input: vec2, yaw: number, jump: boolean, liftY: number, holes: Float32Array, numHoles: number): { pos: vec3, vel: vec3 } {
        let nPos = new vec3(pos.x, pos.y, pos.z);
        let nVel = new vec3(vel.x, vel.y, vel.z);

        const sy = Math.sin(yaw); const cy = Math.cos(yaw);
        const moveX = cy * (-input.x) + sy * input.y;
        const moveZ = cy * input.y - sy * (-input.x);
        
        const speed = WORLD_CONFIG.MOVE_SPEED;
        if (Math.abs(input.x) > 0.01 || Math.abs(input.y) > 0.01) {
            nVel.x = moveX * speed; nVel.z = moveZ * speed;
        } else {
            nVel.x *= 0.1; nVel.z *= 0.1;
        }

        nVel.y += WORLD_CONFIG.GRAVITY * dt;
        if (nVel.y < -30) nVel.y = -30;

        nPos.x += nVel.x * dt; nPos.y += nVel.y * dt; nPos.z += nVel.z * dt;

        // Simple collision resolution (3 spheres)
        const radius = WORLD_CONFIG.COLLISION_RADIUS;
        const checkPoints = [nPos.y - 1.4 + radius, nPos.y - 0.7, nPos.y];
        for (let cpY of checkPoints) {
            let cp = new vec3(nPos.x, cpY, nPos.z);
            let dist = this.getDistance(cp, liftY, holes, numHoles);
            if (dist < radius) {
                const norm = this.getNormal(cp, liftY, holes, numHoles);
                const pen = radius - dist;
                nPos.x += norm.x * pen; nPos.y += norm.y * pen; nPos.z += norm.z * pen;
                const vn = nVel.x * norm.x + nVel.y * norm.y + nVel.z * norm.z;
                if (vn < 0) {
                    if (norm.y > 0.5) { nVel.y = 0; }
                    else { nVel.x -= vn * norm.x; nVel.y -= vn * norm.y; nVel.z -= vn * norm.z; }
                }
            }
        }

        // Snap to ground
        const gDist = this.getDistance(new vec3(nPos.x, nPos.y - 1.4, nPos.z), liftY, holes, numHoles);
        let grounded = (gDist < 0.3 && nVel.y <= 0.1);
        if (jump && grounded) nVel.y = WORLD_CONFIG.JUMP_STRENGTH;

        if (nPos.y < -510) { nPos = new vec3(50, 1.5, 50); nVel = new vec3(0, 0, 0); }
        return { pos: nPos, vel: nVel };
    }
}
