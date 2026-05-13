import { AudioManager } from './AudioManager';
import { InputManager } from './InputManager';
import { NetworkClient } from './NetworkClient';
import { WORLD_CONFIG } from './VoxelEngine';
import { LiftManager } from './LiftManager';
import { ParticleManager } from './ParticleManager';
import { OtherPlayersManager } from './OtherPlayersManager';
import { Player } from './Player';

/**
 * EngineContext
 * Central container for all persistent engine systems and state.
 * Prevents prop-drilling and ref-bloat in React components.
 */
export class EngineContext {
    public audio: AudioManager;
    public input: InputManager;
    public network: NetworkClient;
    public player: Player;
    public lift: LiftManager;
    public particles: ParticleManager;
    public otherPlayers: OtherPlayersManager;
    public wasmCore: any = null;

    // Persistent World Data
    public holesArray: Float32Array;
    public numHoles: number = 0;
    public holeRingIndex: number = 0;

    constructor() {
        this.audio = new AudioManager();
        this.input = new InputManager();
        this.network = new NetworkClient();
        this.player = new Player();
        this.lift = new LiftManager();
        this.particles = new ParticleManager();
        this.otherPlayers = new OtherPlayersManager();

        this.holesArray = new Float32Array(WORLD_CONFIG.MAX_HOLES * 4);
    }

    public addHole(x: number, y: number, z: number, r: number) {
        if (this.wasmCore) {
            this.wasmCore.addHole(x, y, z, r);
        }

        const idx = (this.holeRingIndex % WORLD_CONFIG.MAX_HOLES) * 4;
        this.holesArray[idx] = x;
        this.holesArray[idx + 1] = y;
        this.holesArray[idx + 2] = z;
        this.holesArray[idx + 3] = r;

        this.holeRingIndex++;
        if (this.numHoles < WORLD_CONFIG.MAX_HOLES) {
            this.numHoles = this.holeRingIndex;
        }
    }

    public reset() {
        this.player.reset();
        this.lift.reset();
        this.numHoles = 0;
        this.holeRingIndex = 0;
        this.holesArray.fill(0);
        this.particles.clear();
        this.otherPlayers.clear();
    }
}
