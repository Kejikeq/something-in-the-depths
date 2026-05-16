import React, { useEffect } from 'react';
import { EngineContext } from './EngineContext';
import { VoxelEngine, WORLD_CONFIG, vec3, vec2 } from './VoxelEngine';
import { WebGLRenderer } from './WebGLRenderer';
import { PlayerUIData } from '../components/overlay/HUDOverlay';

export interface GameLoopDeps {
  ctx: EngineContext;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  glRef: React.MutableRefObject<WebGLRenderingContext | null>;
  rendererRef: React.MutableRefObject<WebGLRenderer | null>;
  wasmCoreRef: React.MutableRefObject<any>;
  wasmModuleRef: React.MutableRefObject<any>;
  
  gameStateRef: React.MutableRefObject<'menu' | 'playing'>;
  renderScaleRef: React.MutableRefObject<number>;
  tripleBufferingRef: React.MutableRefObject<boolean>;
  
  fpsRef: React.MutableRefObject<number>;
  pingRef: React.MutableRefObject<number>;
  
  bobTime: React.MutableRefObject<number>;
  walkCycleTime: React.MutableRefObject<number>;
  uTimeRef: React.MutableRefObject<number>;
  
  nearLiftRef: React.MutableRefObject<boolean>;
  nearSignRef: React.MutableRefObject<boolean>;
  jumpQueuedRef: React.MutableRefObject<boolean>;
  hasWonRef: React.MutableRefObject<boolean>;
  
  setHasWon: (val: boolean) => void;
  setPlayerUI: (val: PlayerUIData[]) => void;
  setNearSign: (val: boolean) => void;
  setNearLift: (val: boolean) => void;
  setLiftTarget: (val: number) => void;
  setIsLocked: (val: boolean) => void;
  setFlashlightState: (val: boolean) => void;
  
  performDigging: () => void;
  toggleLift: () => void;
  digRadii: number[];
  digSizeIndexRef: React.MutableRefObject<number>;
}

export function useGameLoop(deps: GameLoopDeps) {
  useEffect(() => {
    const canvas = deps.canvasRef.current;
    if (!canvas || deps.rendererRef.current) return;

    const { ctx } = deps;

    try {
      deps.rendererRef.current = new WebGLRenderer(canvas);
      deps.ctx.chunkRenderer = deps.rendererRef.current.chunkRenderer;
      deps.glRef.current = deps.rendererRef.current.gl;
      if (deps.wasmCoreRef.current) {
        deps.rendererRef.current.setWasmCore(deps.wasmCoreRef.current);
      }
    } catch (e) {
      console.error("Renderer init failed:", e);
      return;
    }

    ctx.input.setCanvas(canvas);

    (window as any)._triggerAction = () => ctx.input.virtualAction();
    (window as any)._triggerJump = () => ctx.input.virtualJump();
    (window as any)._triggerLight = () => { 
        ctx.flashlight.toggle();
        deps.setFlashlightState(ctx.flashlight.getIsOn());
    }
    (window as any)._triggerInteract = () => { (ctx.input as any).triggers.interact = true; }

    (window as any)._performDigging = deps.performDigging;
    (window as any)._toggleLight = () => { 
        ctx.flashlight.toggle();
        deps.setFlashlightState(ctx.flashlight.getIsOn());
    };
    (window as any)._performJump = () => { deps.jumpQueuedRef.current = true; };
    (window as any)._toggleLift = deps.toggleLift;

    const onPointerLockChange = () => deps.setIsLocked(document.pointerLockElement === canvas);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    let lastTime = performance.now();
    let prevGameState = deps.gameStateRef.current;
    
    const frameInterval = 1000 / 60; // 60 FPS limit
    let frameTimes: number[] = [];
    let lastBroadcastTime = 0;
    let rafId: number;
    let frameCounter = 0;
    let lastPlayerUILen = 0;
    let totalMonotonicTime = 0; // Absolute monotonic time for animations

    const render = (time: number) => {
      rafId = requestAnimationFrame(render);

      // Reset lastTime if state just changed to avoid massive DT jump
      if (deps.gameStateRef.current !== prevGameState) {
          lastTime = time;
          prevGameState = deps.gameStateRef.current;
      }

      const deltaTime = time - lastTime;
      if (deltaTime < frameInterval) return;
      
      const dt_sec = deltaTime * 0.001;
      lastTime = time - (deltaTime % frameInterval);
      totalMonotonicTime += dt_sec; 
      deps.uTimeRef.current = totalMonotonicTime; // Update ref immediately
      
      frameCounter++;
      const gl = deps.glRef.current;
      if (!gl) return;
      
      const dt = Math.min(dt_sec, 0.1); 

      frameTimes.push(time);
      while(frameTimes.length > 0 && frameTimes[0] < time - 1000) frameTimes.shift();
      deps.fpsRef.current = frameTimes.length;
      
      const dpr = window.devicePixelRatio || 1.0; 
      const targetW = Math.floor(window.innerWidth * dpr * deps.renderScaleRef.current); 
      const targetH = Math.floor(window.innerHeight * dpr * deps.renderScaleRef.current);
      if(canvas.width !== targetW || canvas.height !== targetH) {
         canvas.width = targetW; canvas.height = targetH;
         if (deps.rendererRef.current) {
             deps.rendererRef.current.resize(targetW, targetH);
         } else {
             gl.viewport(0, 0, canvas.width, canvas.height);
         }
      }

      const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw), sp = Math.sin(ctx.player.pitch), cp = Math.cos(ctx.player.pitch);
      const camDirX = sy * cp, camDirY = sp, camDirZ = cy * cp;
      
      const finalIntensity = ctx.flashlight.update(time);

      // Update game time (24 hour cycle every 24 minutes: 1 min per hour)
      const cycleDuration = 1440000; // 24 minutes in ms
      ctx.gameTime = (8.0 + (time / cycleDuration) * 24.0 + ctx.gameTimeOffset) % 24.0;
      
      const activePetals = ctx.particles.update(dt, time);
      ctx.weather.update(dt);

      if (deps.gameStateRef.current === 'playing') {
        let isMoving = false;
        let jump = false;

        const liftSpeed = WORLD_CONFIG.LIFT_SPEED;
        ctx.lift.update(dt, liftSpeed);

        if (deps.wasmCoreRef.current && deps.wasmModuleRef.current) {
            const core = deps.wasmCoreRef.current;
            const iState = ctx.input.getState();

            if (iState.action) deps.performDigging();
            if (iState.toggleLight) { 
                ctx.flashlight.toggle();
                deps.setFlashlightState(ctx.flashlight.getIsOn());
            }
            if (iState.interact) deps.toggleLift();
            if (deps.jumpQueuedRef.current) { iState.jump = true; deps.jumpQueuedRef.current = false; }
            
            ctx.player.yaw -= iState.lookX * 0.002;
            ctx.player.pitch -= iState.lookY * 0.002;
            ctx.player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, ctx.player.pitch));

            isMoving = Math.abs(iState.moveX) > 0.1 || Math.abs(iState.moveY) > 0.1;
            jump = iState.jump;

            const jData = ctx.input.getJoystickUIData();
            const jBase = document.getElementById('joystick-base');
            const jThumb = document.getElementById('joystick-thumb');
            if (jBase && jThumb) {
                if (jData.active) {
                    jBase.style.left = `${jData.baseX - 48}px`;
                    jBase.style.top = `${jData.baseY - 48}px`;
                    jBase.style.opacity = '1';
                    jThumb.style.transform = `translate(${jData.thumbX}px, ${jData.thumbY}px)`;
                } else {
                    jBase.style.opacity = '0';
                    jThumb.style.transform = `translate(0px, 0px)`;
                }
            }
            
            core.setCameraOrientation(ctx.player.yaw, ctx.player.pitch);
            core.setLiftY(ctx.lift.y);
            
            const nextState = VoxelEngine.tickPhysics(
                ctx.player.pos,
                ctx.player.vel,
                dt,
                new vec2(iState.moveX, iState.moveY),
                ctx.player.yaw,
                jump,
                ctx.lift.y,
                ctx.voxelGrid.holes
            );
            
            ctx.player.pos = nextState.pos;
            ctx.player.vel = nextState.vel;
            
            core.setPosition(ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z, ctx.player.vel.y);

            let currentSpeed = isMoving ? 1.0 : 0.0;
            const lerpFactor = Math.min(1.0, dt * 15.0);
            deps.bobTime.current = deps.bobTime.current * (1.0 - lerpFactor) + currentSpeed * lerpFactor;
            deps.walkCycleTime.current += dt * 8.0 * currentSpeed;
        }

        const dxCh = ctx.player.pos.x;
        const dyCh = ctx.player.pos.y + 499.2;
        const dzCh = ctx.player.pos.z;
        if (dxCh*dxCh + dyCh*dyCh + dzCh*dzCh < 4.0 && !deps.hasWonRef.current) {
            deps.hasWonRef.current = true;
            deps.setHasWon(true);
            
            // Release pointer lock so users can click the "Continue" button
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }

        if (isMoving && ctx.player.vel.y === 0) {
            if (deps.walkCycleTime.current > 4.0) {
                ctx.audio.playStepSound();
                deps.walkCycleTime.current = 0;
            }
        }

        ctx.audio.updateListener(ctx.player.pos, { x: camDirX, y: camDirY, z: camDirZ });
        ctx.audio.updateAmbient(ctx.player.pos.y);

        const fwd = { x: sy * cp, y: sp, z: cy * cp };
        const right = { x: cy, y: 0, z: -sy };
        const up = { x: -sy * sp, y: cp, z: -cy * sp };
        
        const newPlayerUI = ctx.otherPlayers.interpolateAndProject(dt, 8.0, ctx.player, { fwd, right, up });
        // Only update state if length is > 0 OR if it WAS > 0 to avoid continuous empty array updates
        if (newPlayerUI.length > 0 || lastPlayerUILen > 0) {
            if (frameCounter % 5 === 0) deps.setPlayerUI(newPlayerUI);
        }
        lastPlayerUILen = newPlayerUI.length;

        const dxS = ctx.player.pos.x - (-3.0);
        const dzS = ctx.player.pos.z - 28.0;
        const distS = Math.sqrt(dxS*dxS + dzS*dzS);
        const isNearSignNow = distS < 3.0 && ctx.player.pos.y > -2.0;
        
        if (isNearSignNow !== deps.nearSignRef.current) {
          deps.nearSignRef.current = isNearSignNow;
          deps.setNearSign(isNearSignNow);
        }

        const dxL = ctx.player.pos.x - 0.0;
        const dzL = ctx.player.pos.z - 2.5;
        const distL = Math.sqrt(dxL*dxL + dzL*dzL);
        
        const isAtTop = Math.abs(ctx.player.pos.y) < 3.0;
        const isAtBottom = Math.abs(ctx.player.pos.y + 150.0) < 3.0;
        const isNearPlatform = Math.abs(ctx.player.pos.y - ctx.lift.y) < 3.0;
        
        const isNearLiftNow = distL < 5.0 && (isNearPlatform || isAtTop || isAtBottom);
        
        if (isNearLiftNow !== deps.nearLiftRef.current) {
            deps.nearLiftRef.current = isNearLiftNow;
            deps.setNearLift(isNearLiftNow);
        }

      } else {
        ctx.player.yaw += dt * 0.05;
        ctx.player.pos = new vec3(50.0, 5.0, 50.0); // Safe grassy area
      }
      
      if (frameCounter % 10 === 0) {
          let domDepthDot = document.getElementById('player-depth-dot');
          if (domDepthDot) {
              const depthPercent = Math.min(100, (Math.abs(ctx.player.pos.y) / 500) * 100);
              domDepthDot.style.top = `${depthPercent}%`;
          }

          let domFps = document.getElementById('ui-fps');
          if (domFps) domFps.innerText = `FPS: ${deps.fpsRef.current}`;
          
          let domPing = document.getElementById('ui-ping');
          if (domPing) {
              if (ctx.network.isConnected()) {
                  domPing.innerText = `PING: ${deps.pingRef.current} MS`;
                  domPing.className = 'text-emerald-400';
              } else {
                  domPing.innerText = ctx.network.isConnecting ? 'CONNECTING...' : 'DISCONNECTED';
                  domPing.className = 'text-white/40';
              }
          }
      }

      if (time - lastBroadcastTime > 50 && ctx.network.isConnected() && deps.gameStateRef.current === 'playing') {
          ctx.network.broadcastPosition();
          lastBroadcastTime = time;
      }

      if (deps.rendererRef.current) {
        // Calculate Reticle Position via Raymarching
        let reticlePos = { x: 0, y: -1000, z: 0 };
        if (deps.gameStateRef.current === 'playing') {
            let marchT = 0.5;
            for (let i = 0; i < 80; i++) {
                const px = ctx.player.pos.x + camDirX * marchT;
                const py = ctx.player.pos.y + camDirY * marchT;
                const pz = ctx.player.pos.z + camDirZ * marchT;
                const d = VoxelEngine.getDistance(new vec3(px, py, pz), ctx.lift.y, ctx.voxelGrid.holes);
                if (d < 0.01) {
                    reticlePos = { x: px, y: py, z: pz };
                    break;
                }
                marchT += d * 0.95;
                if (marchT > 20.0) break;
            }
        }

        deps.rendererRef.current.render({
          time: deps.uTimeRef.current,
          gameTime: ctx.gameTime,
          camPos: ctx.player.pos,
          camDirX, camDirY, camDirZ,
          // Flashlight direction is now stable, but intensity is variable
          flashlightIntensity: finalIntensity,
          camUpX: -sy * sp, camUpY: cp, camUpZ: -cy * sp,
          camRightX: -cy, camRightY: 0, camRightZ: sy,
          voxelGrid: ctx.voxelGrid,
          recentHoles: ctx.recentHoles,
          flashlightOn: ctx.flashlight.getIsOn() ? 1.0 : 0.0,
          otherPlayersArray: ctx.otherPlayers.otherPlayersArray,
          otherColorsArray: ctx.otherPlayers.otherColorsArray,
          numOtherPlayers: ctx.otherPlayers.numOtherPlayers,
          bobTime: deps.bobTime.current,
          walkCycleTime: deps.walkCycleTime.current,
          liftY: ctx.lift.y,
          petalsArray: ctx.particles.petalsArray,
          activePetals,
          performanceMode: deps.tripleBufferingRef.current ? 1 : 0, 
          maxDistance: deps.renderScaleRef.current < 0.75 ? 150.0 : (deps.renderScaleRef.current < 1.0 ? 180.0 : 250.0),
          reticlePos,
          reticleRadius: deps.digRadii[deps.digSizeIndexRef.current],
          rainIntensity: ctx.weather.getIntensity()
        });
      }
    };
    
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      if (deps.rendererRef.current) {
        deps.rendererRef.current.destroy();
        deps.rendererRef.current = null;
      }
      ctx.input.dispose();
    };
  }, [deps.canvasRef.current, deps.wasmCoreRef.current]);
}

