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
export function abs_vec2(v: vec2) { return new vec2(Math.abs(v.x), Math.abs(v.y)); }
export function abs_vec3(v: vec3) { return new vec3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)); }
export function max_f(a: number, b: number) { return Math.max(a, b); }
export function min_f(a: number, b: number) { return Math.min(a, b); }
export function max_vec2(v: vec2, f: number) { return new vec2(max_f(v.x, f), max_f(v.y, f)); }
export function max_vec3(v: vec3, f: number) { return new vec3(max_f(v.x, f), max_f(v.y, f), max_f(v.z, f)); }
export function clamp_f(v: number, lo: number, hi: number) { return max_f(lo, min_f(v, hi)); }

export class HoleStruct {
    constructor(public x: number, public y: number, public z: number, public r: number) {}
}

export class SDFEngine {
    public holes: HoleStruct[] = [];
    public activeHoles: HoleStruct[] | null = null;

    public setHoles(holes: HoleStruct[]) {
        this.holes = holes;
        this.activeHoles = null;
    }

    public sinNoiseFlat(x: number, y: number, z: number): number {
        let n = Math.sin(x) * Math.sin(y) * Math.sin(z);
        n += 0.5 * Math.sin(x * 2.1 + 1.2) * Math.sin(y * 2.1 + 3.4) * Math.sin(z * 2.1 + 5.6);
        return n;
    }

    public sdSakuraTreeFlat(px: number, py: number, pz: number): Float32Array {
        const boundingD = Math.sqrt(px*px + (py-5.0)*(py-5.0) + pz*pz) - 10.0;
        if (boundingD > 2.0) {
            SDFEngine.OUT[0] = boundingD; SDFEngine.OUT[1] = boundingD; return SDFEngine.OUT;
        }

        const trunkBend = Math.sin(py * 0.2) * 1.2;
        const trunkPx = px - trunkBend; const trunkPy = py - 4.0; const trunkPz = pz;
        const radius = 0.4 * (1.2 - py * 0.08);
        
        let dWood = this.sdCylinderFlat(trunkPx, trunkPy, trunkPz, max_f(radius, 0.05), 4.0);
        
        let branches = 1000.0;
        branches = this.smin(branches, this.sdCapsuleFlat(px,py,pz, Math.sin(3.5*0.2)*1.2, 3.5, 0.0, 4.0, 8.0, 1.5, 0.25), 0.4);
        branches = this.smin(branches, this.sdCapsuleFlat(px,py,pz, Math.sin(4.5*0.2)*1.2, 4.5, 0.0, -3.5, 8.5, -1.0, 0.2), 0.4);
        branches = this.smin(branches, this.sdCapsuleFlat(px,py,pz, Math.sin(6.0*0.2)*1.2, 6.0, 0.0, 1.5, 9.5, -3.5, 0.15), 0.4);
        branches = this.smin(branches, this.sdCapsuleFlat(px,py,pz, Math.sin(5.5*0.2)*1.2, 5.5, 0.0, -2.0, 7.5, 2.5, 0.18), 0.4);
        dWood = this.smin(dWood, branches, 0.4);

        const dL1 = Math.sqrt(px*px + (py-9.5)*(py-9.5) + pz*pz) - 3.5;
        const dL2 = Math.sqrt((px-4.5)*(px-4.5) + (py-8.0)*(py-8.0) + (pz-1.8)*(pz-1.8)) - 3.0;
        const dL3 = Math.sqrt((px+4.0)*(px+4.0) + (py-8.5)*(py-8.5) + (pz+1.5)*(pz+1.5)) - 3.2;
        const dL4 = Math.sqrt((px-2.0)*(px-2.0) + (py-9.8)*(py-9.8) + (pz+4.0)*(pz+4.0)) - 2.8;
        const dL5 = Math.sqrt((px+2.5)*(px+2.5) + (py-7.0)*(py-7.0) + (pz-3.0)*(pz-3.0)) - 2.5;

        let dLeaves = min_f(dL1, min_f(dL2, min_f(dL3, min_f(dL4, dL5))));
        dLeaves = this.smin(dLeaves, dL1, 1.0);
        dLeaves = this.smin(dLeaves, dL2, 0.8);
        dLeaves = this.smin(dLeaves, dL3, 0.8);
        dLeaves = this.smin(dLeaves, dL4, 0.8);
        dLeaves = this.smin(dLeaves, dL5, 0.8);

        SDFEngine.OUT[0] = dWood; SDFEngine.OUT[1] = dLeaves;
        return SDFEngine.OUT;
    }

    public sdLiftFlat(px: number, py: number, pz: number, uLiftY: number, uTime: number): Float32Array {
        const lx = 0, ly = -0.4 + uLiftY + Math.sin(uTime * 0.4) * 0.08, lz = 2.5;
        let resDist = 1000.0;
        let matID = 0.0;

        const bLift = this.sdBoxFlat(px-lx, py-ly-125, pz-lz, 2.5, 126, 2.5);
        if (bLift < 10.0) {
            const dLift = this.sdBoxFlat(px-lx, py-ly, pz-lz, 2.2, 0.6, 2.2);
            let dChains = 1000.0;
            dChains = min_f(dChains, this.sdCylinderFlat(px-lx-2, py-ly-250, pz-lz-2, 0.2, 250));
            dChains = min_f(dChains, this.sdCylinderFlat(px-lx+2, py-ly-250, pz-lz-2, 0.2, 250));
            dChains = min_f(dChains, this.sdCylinderFlat(px-lx-2, py-ly-250, pz-lz+2, 0.2, 250));
            dChains = min_f(dChains, this.sdCylinderFlat(px-lx+2, py-ly-250, pz-lz+2, 0.2, 250));

            if (dLift < dChains) { resDist = dLift; matID = 5.0; } else { resDist = dChains; matID = 5.0; }
        }
        SDFEngine.OUT[0] = resDist; SDFEngine.OUT[1] = matID;
        return SDFEngine.OUT;
    }

    public sdBridgeFlat(px: number, py: number, pz: number): number {
        const dBridge = this.sdBoxFlat(px, py+0.4, pz-16.85, 1.5, 0.6, 12.15);
        const dFenceL = this.sdBoxFlat(px-1.4, py, pz-16.85, 0.15, 0.6, 12.15);
        const dFenceR = this.sdBoxFlat(px+1.4, py, pz-16.85, 0.15, 0.6, 12.15);
        return min_f(dBridge, min_f(dFenceL, dFenceR));
    }

    public sdTerrainFlat(px: number, py: number, pz: number): number {
        let dTerrain = py;
        const dEntrance = Math.sqrt(px*px + pz*pz) - 28.0;
        const wallNoise = this.sinNoiseFlat(px*0.5, py*0.5, pz*0.5) * 1.5; 
        const jaggedWalls = dEntrance + wallNoise;
        const dExcavation = max_f(jaggedWalls, -py - 150.0);
        dTerrain = max_f(dTerrain, -dExcavation);

        if (py <= 0.0) {
            let b = 0.0;
            if (py > -120.0) b = 1.0;
            else if (py > -140.0) b = 0.5;
            else if (py > -240.0) b = 2.0;
            else if (py > -260.0) b = 0.5;
            else if (py > -360.0) b = 3.0;
            else if (py > -380.0) b = 0.5;
            else b = 4.0;

            let dTunnel = 1000.0;
            for(let i = 1; i <= 3; i++) {
                const seed = i * 1.57;
                const pxz_x = Math.sin(py * 0.05 + seed) * 15.0 + Math.cos(py * 0.02) * 5.0;
                const pxz_z = Math.cos(py * 0.04 - seed) * 12.0 + Math.sin(py * 0.01) * 8.0;
                const irregularity = this.sinNoiseFlat(px*0.3, py*0.3, pz*0.3) * 1.2;
                let tube = Math.sqrt((px - pxz_x)**2 + (pz - pxz_z)**2) - (2.2 + irregularity);
                
                const d1 = Math.abs(py + 70.0);
                const d2 = Math.abs(py + 190.0);
                const d3 = Math.abs(py + 310.0);
                const d4 = Math.abs(py + 500.0);
                const biomeFocus = min_f(min_f(d1, d2), min_f(d3, d4));
                
                let sm = (biomeFocus - 40.0) / 40.0;
                sm = max_f(0.0, min_f(1.0, sm));
                tube += sm * sm * (3.0 - 2.0 * sm) * 8.0;
                dTunnel = min_f(dTunnel, tube);
            }
            dTerrain = max_f(dTerrain, -dTunnel);

            const caveSDFFlat = (cx: number, cy: number, cz: number, floorY: number, ceilY: number, scale: number) => {
                const cFloor = cy - floorY;
                const dome = (ceilY - cy) + this.sinNoiseFlat(cx*scale, cy*scale, cz*scale) * 4.5;
                const walls = Math.abs(this.sinNoiseFlat(cx*0.08, cy*0.08, cz*0.08)) - 0.45;
                const bounds = Math.sqrt(cx*cx + cz*cz) - 80.0;
                return max_f(max_f(max_f(cFloor, dome), -walls), bounds);
            };

            if (b === 1.0) dTerrain = max_f(dTerrain, -caveSDFFlat(px, py, pz, -115.0, -25.0, 0.45));
            else if (b === 2.0) dTerrain = max_f(dTerrain, -caveSDFFlat(px, py, pz, -235.0, -145.0, 0.18));
            else if (b === 3.0) dTerrain = max_f(dTerrain, -caveSDFFlat(px, py, pz, -355.0, -265.0, 0.15));
            else if (b === 4.0) {
                const abyssSlab = max_f(Math.abs(py + 440.0) - 60.0, Math.sqrt(px*px + pz*pz) - 100.0);
                dTerrain = max_f(dTerrain, -abyssSlab);
            }
        }

        if (py > -10.0) {
            const dWall = max_f(Math.abs(Math.sqrt(px*px + pz*pz) - 100.0) - 1.25, Math.abs(py - 12.5) - 12.5);
            if (dWall < dTerrain) dTerrain = dWall;
        }
        return dTerrain;
    }

    public sdSignFlat(px: number, py: number, pz: number): number {
        const dSign = this.sdBoxFlat(px+3.0, py, pz-28.0, 0.6, 1.2, 0.6);
        return max_f(dSign, -py - 1.0);
    }

    public sdMirrorFlat(px: number, py: number, pz: number): number {
        return this.sdBoxFlat(px, py-1.5, pz-24.0, 4.0, 2.5, 0.6);
    }

    public sdCylinderFlat(px: number, py: number, pz: number, r: number, h: number): number {
        const dx = Math.abs(Math.sqrt(px*px + pz*pz)) - r;
        const dy = Math.abs(py) - h;
        return min_f(max_f(dx, dy), 0.0) + Math.sqrt(max_f(dx, 0)**2 + max_f(dy, 0)**2);
    }

    public sdBoxFlat(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
        const dx = Math.abs(px) - bx; const dy = Math.abs(py) - by; const dz = Math.abs(pz) - bz;
        return Math.sqrt(max_f(dx, 0)**2 + max_f(dy, 0)**2 + max_f(dz, 0)**2) + min_f(max_f(dx, max_f(dy, dz)), 0.0);
    }
    
    public sdCapsuleFlat(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
        const pax = px - ax, pay = py - ay, paz = pz - az;
        const bax = bx - ax, bay = by - ay, baz = bz - az;
        const h = clamp_f((pax*bax + pay*bay + paz*baz) / (bax*bax + bay*bay + baz*baz), 0.0, 1.0);
        return Math.sqrt((pax - bax*h)**2 + (pay - bay*h)**2 + (pz - az - baz*h)**2) - r;
    }

    public sinNoise(p: vec3): number {
        let n = Math.sin(p.x) * Math.sin(p.y) * Math.sin(p.z);
        n += 0.5 * Math.sin(p.x * 2.1 + 1.2) * Math.sin(p.y * 2.1 + 3.4) * Math.sin(p.z * 2.1 + 5.6);
        return n;
    }

    public sdCylinder(p: vec3, r: number, h: number): number {
        const d = new vec2(Math.abs(length2(new vec2(p.x, p.z))) - r, Math.abs(p.y) - h);
        return min_f(max_f(d.x, d.y), 0.0) + length2(max_vec2(d, 0.0));
    }

    public sdBox(p: vec3, b: vec3): number {
        const q = new vec3(Math.abs(p.x) - b.x, Math.abs(p.y) - b.y, Math.abs(p.z) - b.z);
        return length3(max_vec3(q, 0.0)) + min_f(max_f(q.x, max_f(q.y, q.z)), 0.0);
    }

    public sdCapsule(p: vec3, a: vec3, b: vec3, r: number): number {
        const pa = p.sub(a), ba = b.sub(a);
        const h = clamp_f(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length3(pa.sub(ba.mul(h))) - r;
    }

    public smin(a: number, b: number, k: number): number {
        const h = max_f(k - Math.abs(a - b), 0.0) / k;
        return min_f(a, b) - h * h * h * k * (1.0 / 6.0);
    }

    public smax(a: number, b: number, k: number): number {
        const h = max_f(k - Math.abs(a - b), 0.0) / k;
        return max_f(a, b) + h * h * h * k * (1.0 / 6.0);
    }

    public sdSakuraTree(p: vec3): vec2 {
        const tp = p;
        const boundingD = length3(tp.sub(new vec3(0, 5, 0))) - 10.0;
        if (boundingD > 2.0) return new vec2(boundingD, boundingD);

        const trunkBend = Math.sin(tp.y * 0.2) * 1.2;
        const trunkP = new vec3(tp.x - trunkBend, tp.y - 4.0, tp.z);
        const radius = 0.4 * (1.2 - tp.y * 0.08);
        let dWood = this.sdCylinder(trunkP, max_f(radius, 0.05), 4.0);
        
        let branches = 1000.0;
        branches = this.smin(branches, this.sdCapsule(tp, new vec3(Math.sin(3.5*0.2)*1.2, 3.5, 0.0), new vec3(4.0, 8.0, 1.5), 0.25), 0.4);
        branches = this.smin(branches, this.sdCapsule(tp, new vec3(Math.sin(4.5*0.2)*1.2, 4.5, 0.0), new vec3(-3.5, 8.5, -1.0), 0.2), 0.4);
        branches = this.smin(branches, this.sdCapsule(tp, new vec3(Math.sin(6.0*0.2)*1.2, 6.0, 0.0), new vec3(1.5, 9.5, -3.5), 0.15), 0.4);
        branches = this.smin(branches, this.sdCapsule(tp, new vec3(Math.sin(5.5*0.2)*1.2, 5.5, 0.0), new vec3(-2.0, 7.5, 2.5), 0.18), 0.4);
        
        dWood = this.smin(dWood, branches, 0.4);

        const dL1 = length3(tp.sub(new vec3(0, 9.5, 0))) - 3.5;
        const dL2 = length3(tp.sub(new vec3(4.5, 8.0, 1.8))) - 3.0;
        const dL3 = length3(tp.sub(new vec3(-4.0, 8.5, -1.5))) - 3.2;
        const dL4 = length3(tp.sub(new vec3(2.0, 9.8, -4.0))) - 2.8;
        const dL5 = length3(tp.sub(new vec3(-2.5, 7.0, 3.0))) - 2.5;

        let dLeaves = min_f(dL1, min_f(dL2, min_f(dL3, min_f(dL4, dL5))));
        dLeaves = this.smin(dLeaves, dL1, 1.0);
        dLeaves = this.smin(dLeaves, dL2, 0.8);
        dLeaves = this.smin(dLeaves, dL3, 0.8);
        dLeaves = this.smin(dLeaves, dL4, 0.8);
        dLeaves = this.smin(dLeaves, dL5, 0.8);

        return new vec2(dWood, dLeaves);
    }

    public sdLift(p: vec3, uLiftY: number, uTime: number): vec2 {
        const liftPos = new vec3(0, -0.4 + uLiftY + Math.sin(uTime * 0.4) * 0.08, 2.5);
        
        let resDist = 1000.0;
        let matID = 0.0;

        const bLift = this.sdBox(p.sub(liftPos).sub(new vec3(0, 125, 0)), new vec3(2.5, 126, 2.5));
        if (bLift < 10.0) {
            const dLift = this.sdBox(p.sub(liftPos), new vec3(2.2, 0.6, 2.2));
            let dChains = 1000.0;
            dChains = min_f(dChains, this.sdCylinder(p.sub(liftPos.add(new vec3(2, 250, 2))), 0.2, 250));
            dChains = min_f(dChains, this.sdCylinder(p.sub(liftPos.add(new vec3(-2, 250, 2))), 0.2, 250));
            dChains = min_f(dChains, this.sdCylinder(p.sub(liftPos.add(new vec3(2, 250, -2))), 0.2, 250));
            dChains = min_f(dChains, this.sdCylinder(p.sub(liftPos.add(new vec3(-2, 250, -2))), 0.2, 250));

            if (dLift < dChains) { resDist = dLift; matID = 5.0; } 
            else { resDist = dChains; matID = 5.0; }
        }
        return new vec2(resDist, matID);
    }

    public sdBridge(p: vec3): vec2 {
        const bridgePos = new vec3(0, -0.4, 16.85);
        const dBridge = this.sdBox(p.sub(bridgePos), new vec3(1.5, 0.6, 12.15));
        const dFenceL = this.sdBox(p.sub(new vec3(1.4, 0.0, 16.85)), new vec3(0.15, 0.6, 12.15));
        const dFenceR = this.sdBox(p.sub(new vec3(-1.4, 0.0, 16.85)), new vec3(0.15, 0.6, 12.15));
        const dBridgeFences = min_f(dBridge, min_f(dFenceL, dFenceR));
        return new vec2(dBridgeFences, 4.0);
    }

    public sdTerrain(p: vec3): number {
        let dTerrain = p.y;
        
        const dEntrance = length2(new vec2(p.x, p.z)) - 28.0;
        const wallNoise = this.sinNoise(p.mul(0.5)) * 1.5; 
        const jaggedWalls = dEntrance + wallNoise;
        const dExcavation = max_f(jaggedWalls, -p.y - 150.0);
        dTerrain = max_f(dTerrain, -dExcavation);

        if (p.y <= 0.0) {
            let b = 0.0;
            if (p.y > -120.0) b = 1.0;
            else if (p.y > -140.0) b = 0.5;
            else if (p.y > -240.0) b = 2.0;
            else if (p.y > -260.0) b = 0.5;
            else if (p.y > -360.0) b = 3.0;
            else if (p.y > -380.0) b = 0.5;
            else b = 4.0;

            let dTunnel = 1000.0;
            for(let i = 1; i <= 3; i++) {
                const fi = i;
                const seed = fi * 1.57;
                const pxz_x = Math.sin(p.y * 0.05 + seed) * 15.0 + Math.cos(p.y * 0.02) * 5.0;
                const pxz_z = Math.cos(p.y * 0.04 - seed) * 12.0 + Math.sin(p.y * 0.01) * 8.0;
                
                const irregularity = this.sinNoise(p.mul(0.3)) * 1.2;
                let tube = length2(new vec2(p.x - pxz_x, p.z - pxz_z)) - (2.2 + irregularity);
                
                const d1 = Math.abs(p.y + 70.0);
                const d2 = Math.abs(p.y + 190.0);
                const d3 = Math.abs(p.y + 310.0);
                const d4 = Math.abs(p.y + 500.0);
                const biomeFocus = min_f(min_f(d1, d2), min_f(d3, d4));
                
                let sm = (biomeFocus - 40.0) / 40.0;
                sm = max_f(0.0, min_f(1.0, sm));
                const smoothStep = sm * sm * (3.0 - 2.0 * sm);
                tube += smoothStep * 8.0;
                dTunnel = min_f(dTunnel, tube);
            }
            dTerrain = max_f(dTerrain, -dTunnel);

            const caveSDF = (cp: vec3, floorY: number, ceilY: number, scale: number) => {
                const cFloor = cp.y - floorY;
                const dome = (ceilY - cp.y) + this.sinNoise(cp.mul(scale)) * 4.5;
                const walls = Math.abs(this.sinNoise(cp.mul(0.08))) - 0.45;
                const bounds = length2(new vec2(cp.x, cp.z)) - 80.0;
                return max_f(max_f(max_f(cFloor, dome), -walls), bounds);
            };

            if (b === 1.0) dTerrain = max_f(dTerrain, -caveSDF(p, -115.0, -25.0, 0.45));
            else if (b === 2.0) dTerrain = max_f(dTerrain, -caveSDF(p, -235.0, -145.0, 0.18));
            else if (b === 3.0) dTerrain = max_f(dTerrain, -caveSDF(p, -355.0, -265.0, 0.15));
            else if (b === 4.0) {
                const abyssSlab = max_f(Math.abs(p.y + 440.0) - 60.0, length2(new vec2(p.x, p.z)) - 100.0);
                dTerrain = max_f(dTerrain, -abyssSlab);
            }
        }

        // boundary wall restored
        if (p.y > -10.0) {
            const dWall = max_f(Math.abs(length2(new vec2(p.x, p.z)) - 100.0) - 1.25, Math.abs(p.y - 12.5) - 12.5);
            if (dWall < dTerrain) dTerrain = dWall;
        }
        
        return dTerrain;
    }

    public sdSign(p: vec3): vec2 {
        const signP = p.sub(new vec3(-3.0, 0.0, 28.0));
        let dSign = this.sdBox(signP, new vec3(0.6, 1.2, 0.6));
        return new vec2(max_f(dSign, -p.y - 1.0), 4.0);
    }

    public sdMirror(p: vec3): vec2 {
        const mP = p.sub(new vec3(0, 1.5, 24.0));
        let dMirror = this.sdBox(mP, new vec3(4.0, 2.5, 0.6));
        return new vec2(dMirror, 6.0); // Material ID 6.0 for mirror
    }

    private static OUT = new Float32Array(2);

    public mapFlat(px: number, py: number, pz: number, uLiftY: number = 0, uTime: number = 0): Float32Array {
        px = Math.fround(px); py = Math.fround(py); pz = Math.fround(pz);
        
        let resX = this.sdTerrainFlat(px, py, pz);
        let resY = 0.0;

        let bResX = this.sdBridgeFlat(px, py, pz);
        if (bResX < resX) { resX = bResX; resY = 4.0; }

        let lRes = this.sdLiftFlat(px, py, pz, uLiftY, uTime);
        if (lRes[0] < resX) { resX = lRes[0]; resY = lRes[1]; }

        let sResX = this.sdSignFlat(px, py, pz);
        if (sResX < resX) { resX = sResX; resY = 4.0; }

        let mResX = this.sdMirrorFlat(px, py, pz);
        if (mResX < resX) { resX = mResX; resY = 6.0; }

        let tpx = px - 34.0, tpy = py + 1.0, tpz = pz + 8.0;
        let cRes = this.sdSakuraTreeFlat(tpx, tpy, tpz);
        let dWoodSkin = this.smin(resX, cRes[0], 0.5);
        if (dWoodSkin < resX) {
            resX = dWoodSkin;
            resY = cRes[0] < resX ? 4.0 : resY;
        }
        if (cRes[1] < resX) { resX = cRes[1]; resY = 7.0; }

        const holesList = this.activeHoles || this.holes;
        if (holesList.length > 0) {
            let minHoleDist = 1000.0;
            let first = true;
            const influence = Math.max(8.0, -resX + 2.0);

            for (let i = 0; i < holesList.length; i++) {
                const hx = holesList[i].x; const hy = holesList[i].y; const hz = holesList[i].z;
                const hr = holesList[i].r;
                const dx = px - hx; const dy = py - hy; const dz = pz - hz;
                
                if (Math.abs(dx) > hr + influence || Math.abs(dy) > hr + influence || Math.abs(dz) > hr + influence) continue;
                
                const dSphere = Math.sqrt(dx*dx + dy*dy + dz*dz) - hr;
                if (first) {
                    minHoleDist = dSphere;
                    first = false;
                } else {
                    minHoleDist = this.smin(minHoleDist, dSphere, 0.8);
                }
            }
            if (minHoleDist < 30.0) {
                const val = -minHoleDist;
                const prevDist = resX;
                resX = this.smax(resX, val, 0.8);
                if (val > prevDist - 0.5) {
                    resX = val;
                    if (resY < 100.0) resY += 100.0;
                }
            }
        }
        
        SDFEngine.OUT[0] = Math.fround(resX * 0.65);
        SDFEngine.OUT[1] = Math.fround(resY);
        return SDFEngine.OUT;
    }

    public map(p: vec3, uLiftY: number = 0, uTime: number = 0): vec2 {
        const res = this.mapFlat(p.x, p.y, p.z, uLiftY, uTime);
        return new vec2(res[0], res[1]);
    }
}
