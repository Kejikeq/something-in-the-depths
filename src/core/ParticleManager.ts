export class ParticleManager {
    MAX_PETALS = 20;
    petalsData = Array.from({length: this.MAX_PETALS}, () => ({
        x: 0, y: -1000, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0,
        active: false
    }));
    petalsArray = new Float32Array(this.MAX_PETALS * 4);

    update(dt: number, time: number): number {
        let activePetals = 0;
        const treePos = { x: 34.0, y: -1.0, z: -8.0 };
        const windX = Math.cos(time * 0.001) * 2.0;
        const windZ = Math.sin(time * 0.0015) * 1.5;

        for (let i = 0; i < this.MAX_PETALS; i++) {
            const p = this.petalsData[i];
            if (!p.active) {
                // Random spawn
                if (Math.random() < 0.015) { // very low chance per frame
                    p.active = true;
                    // Spawn inside the canopy
                    p.x = treePos.x + (Math.random() - 0.5) * 6.0;
                    p.y = treePos.y + 7.0 + Math.random() * 2.5; 
                    p.z = treePos.z + (Math.random() - 0.5) * 6.0;
                    p.vx = (Math.random() - 0.5) * 0.5;
                    p.vy = -0.5 - Math.random() * 1.0;
                    p.vz = (Math.random() - 0.5) * 0.5;
                    p.life = 1.0;
                }
            }
            if (p.active) {
                // physics
                p.vx += windX * dt * 0.2;
                p.vz += windZ * dt * 0.2;
                // air resistance
                p.vx *= 0.98;
                p.vz *= 0.98;
                p.vy *= 0.98;
                
                // flutter
                p.vx += Math.cos(time * 0.005 + i) * dt * 2.0;
                p.vz += Math.sin(time * 0.004 + i) * dt * 2.0;

                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt;

                p.life -= dt * 0.05;

                if (p.y < -1.0 || p.life <= 0) {
                    p.active = false;
                } else {
                    this.petalsArray[activePetals * 4] = p.x;
                    this.petalsArray[activePetals * 4 + 1] = p.y;
                    this.petalsArray[activePetals * 4 + 2] = p.z;
                    // pack rotation/wobble into w
                    this.petalsArray[activePetals * 4 + 3] = (time * 0.002 + i) % (Math.PI * 2);
                    activePetals++;
                }
            }
        }
        return activePetals;
    }
}
