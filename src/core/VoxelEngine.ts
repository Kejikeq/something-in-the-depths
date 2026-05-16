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
        uniform vec2 uSunPos;
        uniform float uSunVisible; // 1.0 if in view, 0.0 otherwise
        uniform float uTime;
        uniform float uRainIntensity;

        vec3 lensFlare(vec2 uv, vec2 pos) {
            vec2 mainVec = uv - pos;
            vec2 centerToSun = pos - 0.5;
            float d = length(mainVec);
            
            // 1. Primary Sun Glow (Physical Bloom)
            float glow = pow(max(0.0, 1.0 - d * 6.0), 6.0) * 0.4;
            glow += pow(max(0.0, 1.0 - d * 3.0), 4.0) * 0.05;
            
            // 2. Radial Rays (Sunburst)
            float rays = 0.0;
            float angle = atan(mainVec.y, mainVec.x);
            // Thinner rays using higher powers
            rays += pow(abs(fract(angle * 1.27 - uTime * 0.05) - 0.5) * 2.0, 48.0);
            rays += pow(abs(fract(angle * 3.82 + uTime * 0.02) - 0.5) * 2.0, 36.0);
            rays *= smoothstep(0.3, 0.0, d);
            
            // 3. Anamorphic Horizontal Streak (Shortened)
            float streak = exp(-mainVec.y * mainVec.y * 1200.0) * exp(-mainVec.x * mainVec.x * 24.0);
            streak += exp(-mainVec.y * mainVec.y * 5000.0) * exp(-mainVec.x * mainVec.x * 12.0);
            
            // 4. Ghosts (Multiple blurry discs spread further out)
            vec3 ghostCol = vec3(0.0);
            for (int i = 0; i < 8; i++) {
                float fi = float(i);
                float fiRev = 7.0 - fi;
                // Wider scale distribution to reach screen edges more aggressively
                float scale = (fi * 0.9) - 2.8; 
                
                vec2 gPos = 0.5 + centerToSun * scale;
                float gd = length(uv - gPos);
                
                float size = 0.02 + fiRev * 0.015;
                
                // Chromatic Aberration logic
                float r = smoothstep(size, size - 0.1, gd);
                float g = smoothstep(size, size - 0.1, gd + 0.003);
                float b = smoothstep(size, size - 0.1, gd + 0.006);
                
                vec3 col = vec3(0.1, 0.3, 1.0);
                if (i == 0) col = vec3(1.0, 0.4, 0.2);
                if (i == 1) col = vec3(0.2, 1.0, 0.5);
                if (i == 2) col = vec3(1.0, 0.9, 0.1);
                if (fi == 6.0) col = vec3(0.8, 0.2, 1.0);
                if (fi == 7.0) col = vec3(1.0, 0.2, 0.6); // New edge ghost color
                
                float weight = (1.0 - length(pos - 0.5)) * 0.12;
                ghostCol += vec3(r, g, b) * col * weight;

                // Interior Glint for added realism
                float glint = smoothstep(size * 0.25, 0.0, length(uv - (gPos + normalize(pos - 0.5) * size * 0.4)));
                ghostCol += glint * col * weight * 0.5;
            }
            
            // 5. Broad Halo (Shrunk to match sun size)
            float haloD = length(uv - pos);
            float halo = smoothstep(0.21, 0.20, haloD) * smoothstep(0.19, 0.20, haloD);
            vec3 haloCol = halo * vec3(1.0, 0.7, 0.5) * 0.05;
            
            vec3 final = vec3(glow) * vec3(1.0, 0.95, 0.85);
            final += rays * vec3(1.0, 0.8, 0.6) * 0.04;
            final += streak * vec3(0.3, 0.6, 1.0) * 0.08;
            final += ghostCol;
            final += haloCol;
            
            return final * uSunVisible;
        }
    
        void main() {
            vec2 texel = 1.0 / uResolution;
            vec4 sceneVal = texture2D(uScene, vUv);
            vec3 col = sceneVal.rgb;
            
            // Add Lens Flare
            if (uSunVisible > 0.01 && uRainIntensity < 0.8) {
                // Correct for aspect ratio to keep flares circular
                vec2 flareUv = vUv;
                flareUv.x *= uResolution.x / uResolution.y;
                vec2 flarePos = uSunPos;
                flarePos.x *= uResolution.x / uResolution.y;
                
                // Occlusion check: Sample the scene at sun position
                // In this engine, alpha 0.0 suele means sky/far distance
                vec4 sunSample = texture2D(uScene, uSunPos);
                float occlusion = 1.0;
                
                // If the alpha is high, it means there's a block in front of the sun
                // We use a small threshold and smooth it out
                occlusion = 1.0 - smoothstep(0.0, 0.1, sunSample.a);
                
                if (occlusion > 0.0) {
                    col += lensFlare(flareUv, flarePos) * occlusion * (1.0 - uRainIntensity);
                }
            }
            
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
        const d_xz = Math.sqrt(p.x * p.x + p.z * p.z) - r;
        const d_y = Math.abs(p.y) - h;
        const max_d = Math.max(d_xz, d_y);
        if (max_d <= 0.0) return max_d + Math.sqrt(Math.max(d_xz, 0.0) * Math.max(d_xz, 0.0) + Math.max(d_y, 0.0) * Math.max(d_y, 0.0));
        return Math.sqrt(Math.max(d_xz, 0.0) * Math.max(d_xz, 0.0) + Math.max(d_y, 0.0) * Math.max(d_y, 0.0));
    }

    static sdBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
        const dx = Math.abs(px) - bx;
        const dy = Math.abs(py) - by;
        const dz = Math.abs(pz) - bz;
        const max_d = Math.max(dx, Math.max(dy, dz));
        const qx = Math.max(dx, 0.0);
        const qy = Math.max(dy, 0.0);
        const qz = Math.max(dz, 0.0);
        return ((max_d < 0.0) ? max_d : 0.0) + Math.sqrt(qx*qx + qy*qy + qz*qz);
    }

    static sdTerrain(p: vec3): number {
        // Base ground level at y=0
        let d = p.y;
        
        const distXZ = Math.sqrt(p.x * p.x + p.z * p.z);
        
        // 1. Central Pit (The Abyss)
        const dEntrance = distXZ - 28.0;
        const wallNoise = this.sinNoise(p, 0.5) * 1.5;
        const jaggedWalls = dEntrance + wallNoise;
        const dExcavation = Math.max(jaggedWalls, -p.y - 150.0);
        d = Math.max(d, -dExcavation);

        // 2. Outer Wall
        if (p.y > -10.0) {
            const dWall = Math.max(Math.abs(distXZ - 100.0) - 1.25, Math.abs(p.y - 12.5) - 12.5);
            if (dWall < d) d = dWall;
        }

        // 3. Tunnels and Caves underneath
        if (p.y <= 0.0) {
            const caveSDF = (cp: vec3, floorY: number, ceilY: number, scale: number) => {
                const cFloor = cp.y - floorY;
                const dome = (ceilY - cp.y) + this.sinNoise(new vec3(cp.x * scale, cp.y * scale, cp.z * scale), 1.0) * 4.5;
                const walls = Math.abs(this.sinNoise(new vec3(cp.x * 0.08, cp.y * 0.08, cp.z * 0.08), 1.0)) - 0.45;
                const bounds = Math.sqrt(cp.x * cp.x + cp.z * cp.z) - 80.0;
                return Math.max(Math.max(Math.max(cFloor, dome), -walls), bounds);
            };

            const c1 = caveSDF(p, -115.0, -25.0, 0.45); 
            const c2 = caveSDF(p, -235.0, -145.0, 0.18); 
            const c3 = caveSDF(p, -355.0, -265.0, 0.15); 
            const abyssSlab = Math.max(Math.abs(p.y + 440.0) - 60.0, Math.sqrt(p.x * p.x + p.z * p.z) - 100.0);

            const allCaves = Math.min(Math.min(Math.min(c1, c2), c3), abyssSlab);
            
            let dTunnel = 1000.0;
            for(let i = 1; i <= 3; i++) {
                const fi = i;
                const seed = fi * 1.57;
                const pxz_x = Math.sin(p.y * 0.05 + seed) * 15.0 + Math.cos(p.y * 0.02) * 5.0;
                const pxz_z = Math.cos(p.y * 0.04 - seed) * 12.0 + Math.sin(p.y * 0.01) * 8.0;
                
                const irregularity = this.sinNoise(new vec3(p.x * 0.3, p.y * 0.3, p.z * 0.3), 1.0) * 1.2;
                const tube = Math.sqrt((p.x - pxz_x)**2 + (p.z - pxz_z)**2) - (2.2 + irregularity);
                
                const d1 = Math.abs(p.y + 70.0);
                const d2 = Math.abs(p.y + 190.0);
                const d3 = Math.abs(p.y + 310.0);
                const d4 = Math.abs(p.y + 500.0);
                const biomeFocus = Math.min(Math.min(d1, d2), Math.min(d3, d4));
                
                let sm = Math.max(0.0, Math.min(1.0, (biomeFocus - 40.0) / 40.0));
                const smoothStep = sm * sm * (3.0 - 2.0 * sm);
                dTunnel = Math.min(dTunnel, tube + smoothStep * 8.0);
            }
            
            d = Math.max(d, -Math.min(allCaves, dTunnel));
        }

        return d;
    }

    static getHoleSDF(px: number, py: number, pz: number, holes: {x: number, y: number, z: number, r: number}[]): number {
        let holeD = 1000.0;
        
        for (let i = 0; i < holes.length; i++) {
            const h = holes[i];
            const dx = px - h.x;
            const dy = py - h.y;
            const dz = pz - h.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            
            const r = h.r;
            const dist = Math.sqrt(distSq) - r;
            if (dist < holeD) holeD = dist;
        }
        return holeD;
    }

    static getTerrainMat(p: vec3): number {
        const r = Math.sqrt(p.x * p.x + p.z * p.z);
        const wallThickness = 2.0;
        const distToWallCenter = Math.abs(r - 100.0);
        const isWallArea = distToWallCenter < (wallThickness + 0.5); 
        
        if (isWallArea && p.y > -2.5) {
            return 0.0; // Outer Brick Wall
        } else if (p.y > -1.5 && !isWallArea) {
            return 1.0; // Surface Grass
        } else if (p.y > -4.5 && !isWallArea) {
            return 2.0; // Dirt
        } else if (p.y < -350.0) {
            return 5.0; // Abyss
        } else if (p.y < -240.0 && p.y > -300.0 && r < 60.0) {
            return 6.0; // Mushroom Biome depth
        } else if (p.y < -120.0) {
            return 4.0; // Jungle
        } else if (p.y < -60.0) {
            return 3.0; // Natural Stone deep
        } else {
            return 2.0; // Dirt
        }
    }

    static getTerrainDarkness(p: vec3, holes?: {x: number, y: number, z: number, r: number}[]): number {
        let darkness = 0.0;
        if (holes && holes.length > 0) {
            const h = this.getHoleSDF(p.x, p.y, p.z, holes);
            if (h < 3.0) { 
                const t = Math.max(0, Math.min(1, h / 3.0));
                const influence = 1.0 - (t * t * (3.0 - 2.0 * t)); // smoothstep inverse
                darkness = influence * 0.45;
            }
        }
        return darkness;
    }

    private static mix(a: number, b: number, t: number): number {
        return a * (1.0 - t) + b * t;
    }

    static getDistance(p: vec3, liftY: number, holes: {x: number, y: number, z: number, r: number}[]): number {
        let d = this.sdTerrain(p);

        // Structures - Inlined sdBox calls to avoid allocations
        const liftDist = this.sdBox(p.x, p.y + 0.4 - liftY, p.z - 2.5, 2.7, 0.12, 2.7);
        if (liftDist < d) d = liftDist;

        const bridgeDist = this.sdBox(p.x, p.y + 0.4, p.z - 16.85, 1.5, 0.1, 12.15);
        if (bridgeDist < d) d = bridgeDist;

        // Digging Holes
        if (holes && holes.length > 0) {
            const hDist = this.getHoleSDF(p.x, p.y, p.z, holes);
            if (-hDist > d) d = -hDist;
        }

        return d;
    }

    static getNormal(p: vec3, liftY: number, holes: {x: number, y: number, z: number, r: number}[]): vec3 {
        const eps = 0.01;
        const d = this.getDistance(p, liftY, holes);
        const nx = this.getDistance(new vec3(p.x + eps, p.y, p.z), liftY, holes) - d;
        const ny = this.getDistance(new vec3(p.x, p.y + eps, p.z), liftY, holes) - d;
        const nz = this.getDistance(new vec3(p.x, p.y, p.z + eps), liftY, holes) - d;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len < 0.0001) return new vec3(0, 1, 0);
        return new vec3(nx/len, ny/len, nz/len);
    }

    // --- PHYSICS ENGINE ---

    static tickPhysics(pos: vec3, vel: vec3, dt: number, input: vec2, yaw: number, jump: boolean, liftY: number, holes: {x: number, y: number, z: number, r: number}[]): { pos: vec3, vel: vec3 } {
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
        const checkPoints = [-1.4 + radius, -0.7, 0];
        for (let yOff of checkPoints) {
            let cp = new vec3(nPos.x, nPos.y + yOff, nPos.z);
            let dist = this.getDistance(cp, liftY, holes);
            if (dist < radius) {
                const norm = this.getNormal(cp, liftY, holes);
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
        const gDist = this.getDistance(new vec3(nPos.x, nPos.y - 1.4, nPos.z), liftY, holes);
        let grounded = (gDist < 0.3 && nVel.y <= 0.1);
        if (jump && grounded) nVel.y = WORLD_CONFIG.JUMP_STRENGTH;

        if (nPos.y < -600) { nPos = new vec3(40, 1.5, 40); nVel = new vec3(0, 0, 0); }
        return { pos: nPos, vel: nVel };
    }
}
