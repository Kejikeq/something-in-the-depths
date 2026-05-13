import { VoxelEngine, vec3, vec2 } from './VoxelEngine';

export class Player {
    pos: vec3;
    vel: vec3;
    yaw: number;
    pitch: number;

    constructor() {
        this.pos = new vec3(0, 1.5, 0);
        this.vel = new vec3(0, 0, 0);
        this.yaw = Math.PI;
        this.pitch = 0;
    }

    reset() {
        this.pos = new vec3(0, 1.5, 0);
        this.vel = new vec3(0, 0, 0);
        this.yaw = Math.PI;
        this.pitch = 0;
    }

    update(
        dt: number, 
        inputX: number, 
        inputY: number, 
        iStateYaw: number, 
        jump: boolean, 
        liftY: number, 
        holes: Float32Array, 
        numHoles: number
    ) {
        this.yaw = iStateYaw;

        const nextState = VoxelEngine.tickPhysics(
            this.pos,
            this.vel,
            dt,
            new vec2(inputX, inputY),
            this.yaw,
            jump,
            liftY,
            holes,
            numHoles
        );

        this.pos = nextState.pos;
        this.vel = nextState.vel;
    }
}
