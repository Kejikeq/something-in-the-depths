/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class AudioManager {
  private ctx: AudioContext | null = null;
  private ambientNode: OscillatorNode | null = null;
  private noiseNode: AudioWorkletNode | OscillatorNode | null = null;
  private menuMusicGain: GainNode | null = null;
  private surfaceMusicGain: GainNode | null = null;
  private caveMusicGain: GainNode | null = null;
  private musicInitialized = false;
  private lastDripTime: number = 0;
  private lastRumbleTime: number = 0;
  private currentY: number = 0;

  constructor() {}

  private init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.isMuted) {
          this.ctx.suspend();
      }
    } catch (e) {
      console.warn("Audio Context failed to start", e);
    }
  }

  public isMuted = false;

  public setMuted(mute: boolean) {
    this.isMuted = mute;
    this.updateContextState();
  }

  public isPaused = false;
  
  public setPaused(paused: boolean) {
      this.isPaused = paused;
      this.updateContextState();
  }

  private updateContextState() {
      if (!this.ctx) return;
      if (this.isMuted || this.isPaused) {
          if (this.ctx.state === 'running') this.ctx.suspend();
      } else {
          if (this.ctx.state === 'suspended') this.ctx.resume();
      }
  }

  public resume() {
    if (!this.isMuted && !this.isPaused && this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }


  public playDigSound() {
    this.init();
    if (!this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;
    
    // Low frequency thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    oscGain.gain.setValueAtTime(0.6, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);

    // Crunch/noise burst
    const bufferSize = this.ctx.sampleRate * 0.15; // 150ms
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1000;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    noiseSource.start(t);
  }

  public playStepSound() {
    this.init();
    if (!this.ctx) return;
    this.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(60, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  public playDripSound() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();

    // Random position around the player
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 8;
    panner.positionX.value = Math.cos(angle) * dist;
    panner.positionY.value = 2 + Math.random() * 4;
    panner.positionZ.value = Math.sin(angle) * dist;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 + Math.random() * 400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  public playRumbleSound() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(20 + Math.random() * 10, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(10, this.ctx.currentTime + 2.0);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 40;

    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.16, this.ctx.currentTime + 1.0);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 3.0);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 3.0);
  }

  public playSpatialDig(x: number, y: number, z: number) {
    this.init();
    if (!this.ctx) return;
    this.resume();

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    const delay = this.ctx.createDelay();
    const delayGain = this.ctx.createGain();
    
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 20;
    panner.rolloffFactor = 1;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 0.2);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    
    // Echo effect
    delay.delayTime.value = 0.15 + Math.random() * 0.1;
    delayGain.gain.value = 0.5; // Feedback/Volume of echo
    
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.ctx.destination);

    // Connect to delay for echo
    panner.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(panner); // feedback loop
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  public updateListener(pos: {x: number, y: number, z: number}, dir: {x: number, y: number, z: number}) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    
    const validPos = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
    const validDir = Number.isFinite(dir.x) && Number.isFinite(dir.y) && Number.isFinite(dir.z);

    if (l.positionX) {
      if (validPos) {
        l.positionX.value = pos.x;
        l.positionY.value = pos.y;
        l.positionZ.value = pos.z;
      }
      if (validDir) {
        l.forwardX.value = dir.x;
        l.forwardY.value = dir.y;
        l.forwardZ.value = dir.z;
      }
    } else {
      if (validPos && validDir) {
        l.setPosition(pos.x, pos.y, pos.z);
        l.setOrientation(dir.x, dir.y, dir.z, 0, 1, 0);
      }
    }
  }

  public currentGameState: 'menu' | 'playing' = 'menu';
  public setGameState(state: 'menu' | 'playing') {
      this.currentGameState = state;
  }

  private initMusic() {
    if (!this.ctx || this.musicInitialized) return;
    this.musicInitialized = true;

    // --- Menu Music Layer (Drone + Arp) ---
    this.menuMusicGain = this.ctx.createGain();
    this.menuMusicGain.gain.value = 0;
    this.menuMusicGain.connect(this.ctx.destination);

    const playMenuNote = (freq: number, startTime: number) => {
      if (!this.ctx || !this.menuMusicGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.015, startTime + 1);
      g.gain.linearRampToValueAtTime(0, startTime + 3);
      osc.connect(g);
      g.connect(this.menuMusicGain);
      osc.start(startTime);
      osc.stop(startTime + 3.5);
    };

    const runMenuLoop = () => {
      if (!this.ctx || this.ctx.state === 'closed') return;
      const now = this.ctx.currentTime;
      const notes = [130.81, 196.00, 261.63, 311.13]; // C3, G3, C4, Eb4 (cool mystery vibe)
      for(let i=0; i<4; i++) {
        playMenuNote(notes[i], now + i * 2);
      }
      setTimeout(runMenuLoop, 8000);
    };
    runMenuLoop();

    // --- Surface Music Layer (Peaceful Synth) ---
    this.surfaceMusicGain = this.ctx.createGain();
    this.surfaceMusicGain.gain.value = 0;
    this.surfaceMusicGain.connect(this.ctx.destination);

    const playSurfaceNote = (freq: number, startTime: number) => {
      if (!this.ctx || !this.surfaceMusicGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.02, startTime + 2);
      g.gain.linearRampToValueAtTime(0, startTime + 4);
      osc.connect(g);
      g.connect(this.surfaceMusicGain);
      osc.start(startTime);
      osc.stop(startTime + 4.5);
    };

    const runSurfaceLoop = () => {
      if (!this.ctx || this.ctx.state === 'closed') return;
      const now = this.ctx.currentTime;
      const notes = [261.63, 329.63, 392.00, 440.00]; // C, E, G, A
      for(let i=0; i<4; i++) {
        playSurfaceNote(notes[Math.floor(Math.random() * notes.length)], now + i * 4);
      }
      setTimeout(runSurfaceLoop, 16000);
    };
    runSurfaceLoop();

    // --- Cave Music Layer (Wind + Distant Low Melody) ---
    this.caveMusicGain = this.ctx.createGain();
    this.caveMusicGain.gain.value = 0;
    this.caveMusicGain.connect(this.ctx.destination);

    // Wind noise
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const nGain = this.ctx.createGain();
    nGain.gain.value = 0.03;
    source.connect(filter).connect(nGain).connect(this.caveMusicGain);
    source.start();

    const playCaveNote = () => {
      if (!this.ctx || !this.caveMusicGain || this.ctx.state === 'closed') return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(100 + Math.random() * 50, now);
      f.type = 'lowpass';
      f.frequency.value = 250;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.03, now + 4);
      g.gain.linearRampToValueAtTime(0, now + 8);
      osc.connect(f).connect(g).connect(this.caveMusicGain);
      osc.start(now);
      osc.stop(now + 9);
      setTimeout(playCaveNote, 10000 + Math.random() * 8000);
    };
    playCaveNote();
  }

  public updateAmbient(y: number) {
    this.init();
    if (!this.ctx || this.ctx.state === 'suspended' || !Number.isFinite(y)) return;
    this.currentY = y;
    
    this.initMusic();

    // Crossfade Logic
    const t = this.ctx.currentTime;
    
    if (this.currentGameState === 'menu') {
        if (this.menuMusicGain) this.menuMusicGain.gain.setTargetAtTime(0.6, t, 1.0);
        if (this.surfaceMusicGain) this.surfaceMusicGain.gain.setTargetAtTime(0.0, t, 1.0);
        if (this.caveMusicGain) this.caveMusicGain.gain.setTargetAtTime(0.0, t, 1.0);
    } else {
        if (this.menuMusicGain) this.menuMusicGain.gain.setTargetAtTime(0.0, t, 1.0);
        const isSurface = Math.max(0, Math.min(1, (y + 15) / 15)); // 1.0 at Surface, 0.0 at -15 depth
        if (this.surfaceMusicGain) this.surfaceMusicGain.gain.setTargetAtTime(isSurface * 0.5, t, 1.0);
        if (this.caveMusicGain) this.caveMusicGain.gain.setTargetAtTime((1 - isSurface) * 0.4, t, 1.0);
    }

    if (!this.ambientNode) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      
      osc.type = 'sawtooth';
      filter.type = 'lowpass';
      filter.frequency.value = 100;
      gain.gain.value = 0.015;
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.ambientNode = osc;
    }
    
    const depthFactor = Math.abs(y) / 500;
    this.ambientNode.frequency.setTargetAtTime(30 + depthFactor * 40, this.ctx.currentTime, 1.0);

    // Dynamic Procedural Events
    const now = this.ctx.currentTime;
    
    // Drips (More common in Jungle biome -140 to -240)
    const dripInterval = (y < -140 && y > -260) ? 1.5 : 4.0;
    if (y < -20 && now - this.lastDripTime > dripInterval + Math.random() * 5) {
      this.playDripSound();
      this.lastDripTime = now;
    }

    // Rumbles (Common deep down)
    if (y < -300 && now - this.lastRumbleTime > 10.0 + Math.random() * 20.0) {
      this.playRumbleSound();
      this.lastRumbleTime = now;
    }
  }

  public dispose() {
    if (this.ambientNode) {
      try { this.ambientNode.stop(); } catch(e) {}
      this.ambientNode.disconnect();
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
  }
}
