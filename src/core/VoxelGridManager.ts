
export interface Hole {
    x: number;
    y: number;
    z: number;
    r: number;
}

export class VoxelGridManager {
    public holes: Hole[] = [];
    public version: number = 0;

    constructor() {}

    public addHole(hx: number, hy: number, hz: number, hr: number): Hole {
        if (hr < 2.0) hr = 2.0;
        const newHole = { x: hx, y: hy, z: hz, r: hr };
        this.holes.push(newHole);
        this.version++;
        return newHole;
    }

    public updateHoles(newHoles: Hole[]) {
        this.holes = newHoles;
        this.version++;
    }

    public clear() {
        this.holes = [];
        this.version = 0;
    }
}
