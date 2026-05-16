import { FlashlightManager } from './FlashlightManager';
import { AudioManager } from './AudioManager';
import { InputManager } from './InputManager';
import { NetworkClient } from './NetworkClient';
import { WORLD_CONFIG } from './VoxelEngine';
import { LiftManager } from './LiftManager';
import { ParticleManager } from './ParticleManager';
import { OtherPlayersManager } from './OtherPlayersManager';
import { Player } from './Player';
import { VoxelGridManager } from './VoxelGridManager';
import { WeatherSystem } from './WeatherSystem';

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
    public voxelGrid: VoxelGridManager;
    public flashlight: FlashlightManager;
    public weather: WeatherSystem;
    public gameTime: number = 8.0; // Starting at 8 AM
    public gameTimeOffset: number = 0.0;
    public wasmCore: any = null;

    constructor() {
        this.audio = new AudioManager();
        this.input = new InputManager();
        this.network = new NetworkClient();
        this.player = new Player();
        this.lift = new LiftManager();
        this.particles = new ParticleManager();
        this.otherPlayers = new OtherPlayersManager();
        this.voxelGrid = new VoxelGridManager();
        this.flashlight = new FlashlightManager();
        this.weather = new WeatherSystem(this.audio);
    }

    // A reference to the chunk renderer so we can dirty chunks from context
    public chunkRenderer?: any;
    
    public recentHoles: {x: number, y: number, z: number, r: number, time: number}[] = [];

    private chatListeners: ((data: { text: string; sender: string; timestamp: number }) => void)[] = [];

    public onChatMessage(data: { text: string; sender: string; timestamp: number }) {
        this.chatListeners.forEach(l => l(data));
    }

    public subscribeToChat(callback: (data: { text: string; sender: string; timestamp: number }) => void) {
        this.chatListeners.push(callback);
        return () => {
            this.chatListeners = this.chatListeners.filter(l => l !== callback);
        };
    }

    public addHole(x: number, y: number, z: number, r: number) {
        // Local modification for instant feedback
        this.recentHoles.push({x, y, z, r, time: performance.now()});
        
        const hole = this.voxelGrid.addHole(x, y, z, r);
        if (this.chunkRenderer) {
            this.chunkRenderer.dirtyFromVoxelUpdate(hole.x, hole.y, hole.z, hole.r);
        }
    }

    public reset() {
        this.player.reset();
        this.lift.reset();
        this.voxelGrid.clear();
        this.particles.clear();
        this.otherPlayers.clear();
    }
}
