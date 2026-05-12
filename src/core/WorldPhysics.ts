/**
 * WorldPhysics.ts
 * Manages player collision and movement logic in TypeScript for easier refinement.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class WorldPhysics {
  // Constants for player physics
  static readonly COLLISION_THRESHOLD = 0.35; // Slightly smaller than visual model (0.45) to prevent sticking
  static readonly PLAYER_HEIGHT = 1.4;
  static readonly MOVE_SPEED = 8.0;
  static readonly GRAVITY = -15.0;
  static readonly JUMP_STRENGTH = 6.5;

  /**
   * Normalizes joystick/keyboard input to ensure diagonal movement isn't faster.
   */
  static applyJoystickInput(moveX: number, moveY: number): { x: number, y: number } {
    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 1.0) {
      return { x: moveX / len, y: moveY / len };
    }
    return { x: moveX, y: moveY };
  }

  /**
   * A simplified TypeScript implementation of the scene SDF for collision.
   * This should be kept in sync with WorldEngine.ts and GameState.cpp.
   */
  static sdBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
    const dx = Math.abs(px) - bx;
    const dy = Math.abs(py) - by;
    const dz = Math.abs(pz) - bz;
    const outX = Math.max(dx, 0);
    const outY = Math.max(dy, 0);
    const outZ = Math.max(dz, 0);
    const outD = Math.sqrt(outX*outX + outY*outY + outZ*outZ);
    const inD = Math.min(Math.max(dx, dy, dz), 0);
    return outD + inD;
  }

  static sdCylinder(px: number, py: number, pz: number, r: number, h: number): number {
    const dx = Math.sqrt(px*px + pz*pz) - r;
    const dy = Math.abs(py) - h;
    const outD = Math.sqrt(Math.max(dx, 0)**2 + Math.max(dy, 0)**2);
    const inD = Math.min(Math.max(dx, dy), 0);
    return outD + inD;
  }

  static sinNoise(p: Vec3): number {
      const scale = 1.0;
      return Math.sin(p.x * scale) * Math.sin(p.y * scale) * Math.sin(p.z * scale);
  }

  static sdTerrain(p: Vec3): number {
        let dTerrain = p.y;
        
        const dist2D = Math.sqrt(p.x * p.x + p.z * p.z);
        const dEntrance = dist2D - 28.0;
        const wallNoise = this.sinNoise({ x: p.x * 0.5, y: p.y * 0.5, z: p.z * 0.5 }) * 1.5; 
        const jaggedWalls = dEntrance + wallNoise;
        const dExcavation = Math.max(jaggedWalls, -p.y - 150.0);
        dTerrain = Math.max(dTerrain, -dExcavation);

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
                
                const irregularity = this.sinNoise({ x: p.x * 0.3, y: p.y * 0.3, z: p.z * 0.3 }) * 1.2;
                const distOffset = Math.sqrt((p.x - pxz_x)**2 + (p.z - pxz_z)**2);
                let tube = distOffset - (2.2 + irregularity);
                
                const d1 = Math.abs(p.y + 70.0);
                const d2 = Math.abs(p.y + 190.0);
                const d3 = Math.abs(p.y + 310.0);
                const d4 = Math.abs(p.y + 500.0);
                const biomeFocus = Math.min(Math.min(d1, d2), Math.min(d3, d4));
                
                let sm = (biomeFocus - 40.0) / 40.0;
                sm = Math.max(0.0, Math.min(1.0, sm));
                const smoothStep = sm * sm * (3.0 - 2.0 * sm);
                tube += smoothStep * 8.0;
                dTunnel = Math.min(dTunnel, tube);
            }
            dTerrain = Math.max(dTerrain, -dTunnel);

            const caveSDF = (cpX: number, cpY: number, cpZ: number, floorY: number, ceilY: number, scale: number) => {
                const cFloor = cpY - floorY;
                const dome = (ceilY - cpY) + this.sinNoise({ x: cpX * scale, y: cpY * scale, z: cpZ * scale }) * 4.5;
                const walls = Math.abs(this.sinNoise({ x: cpX * 0.08, y: cpY * 0.08, z: cpZ * 0.08 })) - 0.45;
                const bounds = dist2D - 80.0;
                return Math.max(Math.max(Math.max(cFloor, dome), -walls), bounds);
            };

            if (b === 1.0) dTerrain = Math.max(dTerrain, -caveSDF(p.x, p.y, p.z, -115.0, -25.0, 0.45));
            else if (b === 2.0) dTerrain = Math.max(dTerrain, -caveSDF(p.x, p.y, p.z, -235.0, -145.0, 0.18));
            else if (b === 3.0) dTerrain = Math.max(dTerrain, -caveSDF(p.x, p.y, p.z, -355.0, -265.0, 0.15));
            else if (b === 4.0) {
                const abyssSlab = Math.max(Math.abs(p.y + 440.0) - 60.0, dist2D - 100.0);
                dTerrain = Math.max(dTerrain, -abyssSlab);
            }
        }

        if (p.y > -10.0) {
            const dWall = Math.max(Math.abs(dist2D - 100.0) - 1.25, Math.abs(p.y - 12.5) - 12.5);
            if (dWall < dTerrain) dTerrain = dWall;
        }
        
        return dTerrain;
  }

  static getDistance(p: Vec3, liftY: number, holes: Float32Array, numHoles: number): number {
    let d = this.sdTerrain(p);

    // 4. Lift
    const liftDist = this.sdBox(p.x, p.y + 0.4 - liftY, p.z - 2.5, 2.7, 0.12, 2.7);
    d = Math.min(d, liftDist);

    // 5. Bridge and Pier
    const bridgeDist = this.sdBox(p.x, p.y + 0.4, p.z - 16.85, 1.5, 0.1, 12.15);
    
    // Fences
    const fenceL = this.sdBox(p.x - 1.4, p.y, p.z - 16.85, 0.08, 0.8, 12.15);
    const fenceR = this.sdBox(p.x + 1.4, p.y, p.z - 16.85, 0.08, 0.8, 12.15);

    const pierDist = this.sdBox(p.x, p.y + 0.4, p.z - 55.0, 2.5, 0.15, 15.0);

    // Sign
    const signBox = this.sdBox(p.x + 3.0, p.y, p.z - 28.0, 0.6, 1.2, 0.6);
    const signDist = Math.max(signBox, -p.y - 1.0);

    // 7. Sakura Tree
    const tpX = p.x - 34.0, tpY = p.y + 1.0, tpZ = p.z + 8.0;
    const trunkX = tpX - Math.sin(tpY * 0.2) * 1.2;
    const treeDist = Math.max(Math.sqrt(trunkX*trunkX + tpZ*tpZ) - 0.4, Math.abs(tpY - 4.0) - 4.0);

    // 8. Mirror
    const mirrorDist = this.sdBox(p.x, p.y - 1.5, p.z - 24.0, 4.0, 2.5, 0.6);

    d = Math.min(d, bridgeDist, fenceL, fenceR, pierDist, treeDist, mirrorDist, signDist);

    // 9. Digging Holes
    for (let i = 0; i < numHoles; i++) {
        const hX = holes[i * 4];
        const hY = holes[i * 4 + 1];
        const hZ = holes[i * 4 + 2];
        const hR = holes[i * 4 + 3];
        
        const dx = p.x - hX;
        const dy = p.y - hY;
        const dz = p.z - hZ;
        const distHole = Math.sqrt(dx*dx + dy*dy + dz*dz) - hR;
        
        // Subtract hole from geometry (max with negative distance)
        d = Math.max(d, -distHole);
    }

    return d * 0.65; // Relaxation factor to match shader
  }

  /**
   * Computes the surface normal at a point p using the SDF.
   */
  static getNormal(p: Vec3, liftY: number, holes: Float32Array, numHoles: number): Vec3 {
    const eps = 0.01;
    const d = this.getDistance(p, liftY, holes, numHoles);
    const nx = this.getDistance({ x: p.x + eps, y: p.y, z: p.z }, liftY, holes, numHoles) - d;
    const ny = this.getDistance({ x: p.x, y: p.y + eps, z: p.z }, liftY, holes, numHoles) - d;
    const nz = this.getDistance({ x: p.x, y: p.y, z: p.z + eps }, liftY, holes, numHoles) - d;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 0.0001) return { x: 0, y: 1, z: 0 };
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /**
   * Performs one physics tick. Ported from GameState.cpp for TS-side refinement.
   */
  static tick(
    pos: Vec3, 
    vel: Vec3, 
    dt: number, 
    inputX: number, 
    inputY: number, 
    yaw: number, 
    jump: boolean,
    liftY: number, 
    holes: Float32Array, 
    numHoles: number
  ): { pos: Vec3, vel: Vec3 } {
    let nextPos = { ...pos };
    let nextVel = { ...vel };

    // 1. Horizontal Movement
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    
    // Normalize input
    const moveInput = this.applyJoystickInput(inputX, inputY);
    
    // Camera relative to world
    const moveX = cy * (-moveInput.x) + sy * moveInput.y;
    const moveZ = cy * moveInput.y - sy * (-moveInput.x);

    if (Math.sqrt(moveX*moveX + moveZ*moveZ) > 0.01) {
        nextVel.x = moveX * this.MOVE_SPEED;
        nextVel.z = moveZ * this.MOVE_SPEED;
    } else {
        nextVel.x *= 0.1; // Faster friction in TS for snappier feel
        nextVel.z *= 0.1;
    }

    // 2. Apply Horizontal Step and Collision
    nextPos.x += nextVel.x * dt;
    nextPos.z += nextVel.z * dt;

    // Boundary check / Wall collision
    // We only check waist height to allow stepping up. Obstacles are made artificially taller in physics if needed.
    const heights = [nextPos.y - 0.7]; 
    for (const h of heights) {
        for (let i = 0; i < 4; i++) {
            const dist = this.getDistance({ x: nextPos.x, y: h, z: nextPos.z }, liftY, holes, numHoles);
            if (dist < this.COLLISION_THRESHOLD) {
                const n = this.getNormal({ x: nextPos.x, y: h, z: nextPos.z }, liftY, holes, numHoles);
                const push = (this.COLLISION_THRESHOLD - dist) * 1.5;
                nextPos.x += n.x * push;
                nextPos.z += n.z * push;
            } else {
                break;
            }
        }
    }

    // 3. Gravity and Vertical Movement
    nextVel.y += this.GRAVITY * dt;
    if (nextVel.y < -30) nextVel.y = -30; // Terminal velocity
    nextPos.y += nextVel.y * dt;

    // 4. Floor Collision
    const distToFloor = this.getDistance({ x: nextPos.x, y: nextPos.y - this.PLAYER_HEIGHT, z: nextPos.z }, liftY, holes, numHoles);
    
    // Simple snap to floor
    if (distToFloor < 0.0) {
        nextPos.y -= distToFloor;
        if (nextVel.y < 0) nextVel.y = 0;
        
        // Jump
        if (jump) {
            nextVel.y = this.JUMP_STRENGTH;
        }
    }

    // 5. World Bounds (Fall limit)
    if (nextPos.y < -510) {
        nextPos = { x: 0, y: 1.5, z: 0 };
        nextVel = { x: 0, y: 0, z: 0 };
    }

    return { pos: nextPos, vel: nextVel };
  }

  static doDigRaycast(
    ro: Vec3, 
    rd: Vec3, 
    liftY: number, 
    holes: Float32Array, 
    numHoles: number,
    maxDist: number = 18.0
  ): { x: number, y: number, z: number, r: number } | null {
    let t = 0.0;
    for (let i = 0; i < 100; i++) {
        const p = {
            x: ro.x + rd.x * t,
            y: ro.y + rd.y * t,
            z: ro.z + rd.z * t
        };
        const d = this.getDistance(p, liftY, holes, numHoles);
        if (d < 0.01) {
            // Hit!
            // Move it slightly deeper into the wall so the hole cuts properly
            const hitP = {
                x: p.x + rd.x * 1.5,
                y: p.y + rd.y * 1.5,
                z: p.z + rd.z * 1.5
            };
            return {
                x: hitP.x,
                y: hitP.y,
                z: hitP.z,
                r: 1.5
            };
        }
        t += d;
        if (t > maxDist) break;
    }
    return null;
  }
}
