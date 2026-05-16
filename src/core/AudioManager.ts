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
  private musicBPM = 105;
  private currentStep = 0;
  private lastDripTime: number = 0;
  private lastRumbleTime: number = 0;
  private currentY: number = 0;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

  constructor() {}

  public init() {
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
    
    // Low frequency thud - deeper and shorter for earth
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine'; // Sine is softer for earth
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.1);
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);

    // Muffled noise burst (soil/dirt sound)
    const bufferSize = this.ctx.sampleRate * 0.2; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass'; // Lowpass for muffled earth sound
    noiseFilter.frequency.value = 450;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, t);
    noiseGain.gain.linearRampToValueAtTime(0.01, t + 0.2);
    
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

    const t = this.ctx.currentTime;
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
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
    
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    
    // Muffled noise burst for spatial digging
    const bufferSize = this.ctx.sampleRate * 0.15; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 400;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, t);
    noiseGain.gain.linearRampToValueAtTime(0.01, t + 0.15);

    // Echo effect components
    delay.delayTime.value = 0.15 + Math.random() * 0.1;
    delayGain.gain.value = 0.4;
    
    osc.connect(gain);
    gain.connect(panner);

    noiseSource.connect(noiseFilter).connect(noiseGain).connect(panner);

    panner.connect(this.ctx.destination);

    // Connect to delay for echo
    panner.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(panner); // feedback loop
    
    osc.start(t);
    osc.stop(t + 0.2);
    noiseSource.start(t);
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

  private initRain() {
      if (!this.ctx || this.rainGain) return;
      
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      
      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = 'lowpass';
      this.rainFilter.frequency.value = 1000;
      
      // Create continuous noise for rain
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
      }
      
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      
      source.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.ctx.destination);
      
      source.start();
  }

  public setRainVolume(volume: number) {
      this.init();
      if (!this.ctx) return;
      this.initRain();
      
      const t = this.ctx.currentTime;
      // Fade frequency along with volume for a "getting heavier" feel
      if (this.rainFilter) {
          const freq = 600 + volume * 1200;
          this.rainFilter.frequency.setTargetAtTime(freq, t, 0.5);
      }
      if (this.rainGain) {
          this.rainGain.gain.setTargetAtTime(volume * 0.15, t, 0.5);
      }
  }

  private initMusic() {
    if (!this.ctx || this.musicInitialized) return;
    this.musicInitialized = true;

    // --- Audio Nodes ---
    this.menuMusicGain = this.ctx.createGain();
    this.menuMusicGain.gain.value = 0;
    this.surfaceMusicGain = this.ctx.createGain();
    this.surfaceMusicGain.gain.value = 0;
    this.caveMusicGain = this.ctx.createGain();
    this.caveMusicGain.gain.value = 0;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.connect(this.ctx.destination);

    this.menuMusicGain.connect(compressor);
    this.surfaceMusicGain.connect(compressor);
    this.caveMusicGain.connect(compressor);

    // Filtered noise for hi-hats/snares
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < this.ctx.sampleRate; i++) noiseData[i] = Math.random() * 2 - 1;

    // --- Musical Helpers ---
    const playInstrument = (gain: GainNode, freq: number, mode: 'piano' | 'guitar' | 'koto' | 'bass' | 'strings', start: number, dur: number, vol: number) => {
        if (!this.ctx || !Number.isFinite(freq) || !Number.isFinite(start) || !Number.isFinite(vol)) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        
        g.gain.setValueAtTime(0.0001, start);
        
        if (mode === 'piano') {
            o.type = 'sine';
            const o2 = this.ctx.createOscillator();
            o2.type = 'triangle';
            o2.frequency.setValueAtTime(freq * 2.01, start);
            const g2 = this.ctx.createGain();
            g2.gain.setValueAtTime(vol * 0.4, start);
            g2.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            o2.start(start);
            o2.stop(start + dur + 0.1);
            o2.connect(g2).connect(g);
            
            g.gain.linearRampToValueAtTime(vol, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur + 1.2);
        } else if (mode === 'guitar') {
            o.type = 'sawtooth';
            f.type = 'lowpass';
            f.frequency.setValueAtTime(4000, start);
            f.frequency.exponentialRampToValueAtTime(150, start + dur);
            f.Q.value = 8;
            o.connect(f).connect(g);
            g.gain.linearRampToValueAtTime(vol, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur + 0.6);
        } else if (mode === 'koto') {
            o.type = 'triangle';
            f.type = 'bandpass';
            f.frequency.value = freq * 1.5;
            o.connect(f).connect(g);
            g.gain.linearRampToValueAtTime(vol, start + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        } else if (mode === 'strings') {
            o.type = 'sawtooth';
            f.type = 'lowpass';
            f.frequency.setValueAtTime(100, start);
            f.frequency.exponentialRampToValueAtTime(1500, start + dur * 0.5);
            
            // Vibrato
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();
            lfo.frequency.value = 5 + Math.random() * 2;
            lfoGain.gain.value = freq * 0.012;
            lfo.connect(lfoGain);
            lfoGain.connect(o.frequency);
            lfo.start(start);
            lfo.stop(start + dur + 2);

            o.connect(f).connect(g);
            g.gain.linearRampToValueAtTime(vol, start + dur * 0.4); // Slow attack
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur + 2.0);
        } else if (mode === 'bass') {
            o.type = 'triangle';
            f.type = 'lowpass';
            f.frequency.value = 150;
            o.connect(f).connect(g);
            g.gain.linearRampToValueAtTime(vol, start + 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur + 0.2);
        }

        o.frequency.setValueAtTime(freq, start);
        if (f.numberOfInputs === 0) o.connect(g); 
        g.connect(gain);
        o.start(start);
        o.stop(start + dur + 2.1);
    };

    const playDrum = (gain: GainNode, type: 'kick' | 'hat', start: number) => {
        if (!this.ctx || !Number.isFinite(start)) return;
        if (type === 'kick') {
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.frequency.setValueAtTime(120, start);
            o.frequency.exponentialRampToValueAtTime(0.001, start + 0.15);
            g.gain.setValueAtTime(0.2, start);
            g.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
            o.connect(g).connect(gain);
            o.start(start);
            o.stop(start + 0.15);
        } else {
            const source = this.ctx.createBufferSource();
            source.buffer = noiseBuffer;
            const g = this.ctx.createGain();
            const f = this.ctx.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = 8000;
            g.gain.setValueAtTime(0.03, start);
            g.gain.exponentialRampToValueAtTime(0.001, start + 0.04);
            source.connect(f).connect(g).connect(gain);
            source.start(start);
            source.stop(start + 0.04);
        }
    };

    // --- Sequencer ---
    const runSequencer = () => {
        if (!this.ctx || this.ctx.state === 'closed') return;
        const now = this.ctx.currentTime;
        const stepDur = 60 / this.musicBPM / 4; // 16th note
        
        while (scheduleTime < now + 0.2) {
            const step = this.currentStep % 64;
            
            // --- MENU MUSIC (Piano/Koto/Strings) ---
            const menuScale = [130.81, 146.83, 164.81, 196.00, 220.00]; // C D E G A
            if (this.currentGameState === 'menu') {
                if (step % 16 === 0) {
                    playInstrument(this.menuMusicGain!, menuScale[0] / 2, 'bass', scheduleTime, 1.0, 0.04);
                }
                if (step % 8 === 4 && Math.random() > 0.5) {
                    playInstrument(this.menuMusicGain!, menuScale[Math.floor(Math.random() * 5)], 'piano', scheduleTime, 0.4, 0.02);
                }
                if (step % 32 === 0) {
                    playInstrument(this.menuMusicGain!, menuScale[Math.floor(Math.random() * 3)] * 2, 'strings', scheduleTime, 2.0, 0.015);
                }
                if (step % 32 === 12) {
                     playInstrument(this.menuMusicGain!, menuScale[Math.floor(Math.random() * 5)] * 2, 'koto', scheduleTime, 0.2, 0.015);
                }
            }

            // --- SURFACE MUSIC ---
            const prog = [
                { root: 261.63, type: 'major' }, // C
                { root: 220.00, type: 'minor' }, // Am
                { root: 174.61, type: 'major' }, // F
                { root: 196.00, type: 'major' }  // G
            ];
            const chordData = prog[Math.floor(this.currentStep / 16) % prog.length];
            const getChordNote = (idx: number) => {
                const intervals = chordData.type === 'major' ? [0, 4, 7, 12] : [0, 3, 7, 12];
                const iIdx = Math.floor(idx) % intervals.length;
                return chordData.root * Math.pow(2, intervals[iIdx] / 12);
            };

            if (this.currentGameState === 'playing' && this.currentY > -40) {
               // Bass
               if (step % 8 === 0) {
                   playInstrument(this.surfaceMusicGain!, chordData.root / 2, 'bass', scheduleTime, 0.2, 0.03);
                   playDrum(this.surfaceMusicGain!, 'kick', scheduleTime);
               }
               // Backing Strings
               if (step % 16 === 0) {
                   playInstrument(this.surfaceMusicGain!, chordData.root, 'strings', scheduleTime, 1.5, 0.02);
               }
               // Percussion
               if (step % 4 === 2) {
                   playDrum(this.surfaceMusicGain!, 'hat', scheduleTime);
               }
               // Arp Guitar
               if (step % 4 === 0 || step % 4 === 2) {
                   playInstrument(this.surfaceMusicGain!, getChordNote(step / 4), 'guitar', scheduleTime, 0.3, 0.015);
               }
               // Melody Piano
               if (step % 16 === 8 && Math.random() > 0.3) {
                   playInstrument(this.surfaceMusicGain!, getChordNote(4 + Math.floor(Math.random() * 3)), 'piano', scheduleTime, 0.6, 0.02);
               }
            }

            // --- CAVE MUSIC (Ambient Piano/Strings) ---
            if (this.currentGameState === 'playing' && this.currentY <= -40) {
               const caveScale = [130.81, 155.56, 174.61, 196.00, 233.08]; // C Eb F G Bb
               if (step % 32 === 0) {
                   playInstrument(this.caveMusicGain!, caveScale[0] / 2, 'bass', scheduleTime, 2.0, 0.03);
               }
               // Swelling strings
               if (step % 32 === 16) {
                   playInstrument(this.caveMusicGain!, caveScale[Math.floor(Math.random() * 3)], 'strings', scheduleTime, 3.0, 0.025);
               }
               if (step % 16 === 8 && Math.random() > 0.6) {
                   playInstrument(this.caveMusicGain!, caveScale[Math.floor(Math.random() * 5)], 'piano', scheduleTime, 1.2, 0.015);
               }
               if (step % 64 === 48) {
                    playInstrument(this.caveMusicGain!, caveScale[Math.floor(Math.random() * 5)] * 2, 'koto', scheduleTime, 0.4, 0.01);
               }
            }


            scheduleTime += stepDur;
            this.currentStep++;
        }
        setTimeout(runSequencer, 100);
    };

    let scheduleTime = this.ctx.currentTime;
    runSequencer();
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
      
      osc.type = 'triangle';
      filter.type = 'lowpass';
      filter.frequency.value = 80;
      gain.gain.value = 0.012;
      
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
