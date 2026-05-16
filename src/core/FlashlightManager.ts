
export class FlashlightManager {
  private intensity: number = 1.0;
  private isOn: boolean = true;
  private baseBrightness: number = 0.8; // Increased base brightness

  constructor() {}

  public update(time: number): number {
    if (!this.isOn) return 0;

    const fTime = time * 0.001;
    
    // Organic flickering pattern: combined sine waves with lower amplitudes
    const flicker = 
      Math.sin(fTime * 12.0) * 0.03 + 
      Math.sin(fTime * 31.0) * 0.02 + 
      Math.sin(fTime * 0.8) * 0.15; // Slow ambient swelling

    // Calculate final intensity with a lower cap to prevent over-exposure
    this.intensity = Math.max(0.2, Math.min(1.0, this.baseBrightness + flicker));
    
    return this.intensity;
  }

  public toggle() {
    this.isOn = !this.isOn;
  }

  public setOn(val: boolean) {
    this.isOn = val;
  }

  public getIsOn(): boolean {
    return this.isOn;
  }

  public getIntensity(): number {
    return this.isOn ? this.intensity : 0;
  }
}
