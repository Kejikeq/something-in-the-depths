import { AudioManager } from './AudioManager';

export class WeatherSystem {
    private isRaining = false;
    private rainIntensity = 0;
    private targetIntensity = 0;
    private lastToggleTime = Date.now();
    private audioManager: AudioManager;
    private _onRainChange: ((raining: boolean) => void) | null = null;

    constructor(audioManager: AudioManager) {
        this.audioManager = audioManager;
    }

    public setOnRainChange(cb: (raining: boolean) => void) {
        this._onRainChange = cb;
    }

    public update(dt: number) {
        const now = Date.now();
        
        // Random weather change every 10-20 minutes
        // For testing, let's make it shorter if we want, or just respect the user's request
        // 10 mins = 600,000ms
        const timeSinceLastChange = now - this.lastToggleTime;
        const interval = 600000 + Math.random() * 600000; 

        if (timeSinceLastChange > interval) {
            this.toggleRain(!this.isRaining);
            this.lastToggleTime = now;
        }

        // Smooth transition for intensity
        if (Math.abs(this.rainIntensity - this.targetIntensity) > 0.001) {
            const dir = Math.sign(this.targetIntensity - this.rainIntensity);
            this.rainIntensity += dir * dt * 0.2; // 5 seconds to full rain
            this.rainIntensity = Math.max(0, Math.min(1, this.rainIntensity));
            
            // Update audio volume
            this.audioManager.setRainVolume(this.rainIntensity);
        }
    }

    public toggleRain(on: boolean) {
        this.isRaining = on;
        this.targetIntensity = on ? 1.0 : 0.0;
        if (this._onRainChange) this._onRainChange(on);
    }

    public getIntensity() {
        return this.rainIntensity;
    }

    public isItRaining() {
        return this.isRaining;
    }
}
