import { useEffect } from 'react';
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
  
  flashlightOn: React.MutableRefObject<number>;
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
  
  performDigging: () => void;
  toggleLift: () => void;
}

export function useGameLoop(deps: GameLoopDeps) {
  useEffect(() => {
    const canvas = deps.canvasRef.current;
    if (!canvas || deps.rendererRef.current) return;

    const { ctx } = deps;

    try {
      deps.rendererRef.current = new WebGLRenderer(canvas);
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
    (window as any)._triggerLight = () => { (ctx.input as any).triggers.toggleLight = true; }
    (window as any)._triggerInteract = () => { (ctx.input as any).triggers.interact = true; }

    (window as any)._performDigging = deps.performDigging;
    (window as any)._toggleLight = () => { deps.flashlightOn.current = deps.flashlightOn.current > 0.5 ? 0.0 : 1.0; };
    (window as any)._performJump = () => { deps.jumpQueuedRef.current = true; };
    (window as any)._toggleLift = deps.toggleLift;

    const onPointerLockChange = () => deps.setIsLocked(document.pointerLockElement === canvas);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    let lastTime = performance.now();
    const frameInterval = 1000 / 60; // 60 FPS limit
    let frameTimes: number[] = [];
    let lastBroadcastTime = 0;
    let rafId: number;
    let frameCounter = 0;

    const render = (time: number) => {
      rafId = requestAnimationFrame(render);

      const deltaTime = time - lastTime;
      if (deltaTime < frameInterval) return;
      
      lastTime = time - (deltaTime % frameInterval);
      
      frameCounter++;
      const gl = deps.glRef.current;
      if (!gl) return;
      
      const dt = Math.min(deltaTime * 0.001, 0.1); 

      frameTimes.push(time);
      while(frameTimes.length > 0 && frameTimes[0] < time - 1000) frameTimes.shift();
      deps.fpsRef.current = frameTimes.length;

      const dpr = Math.min(window.devicePixelRatio, 1.5); 
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
      
      const activePetals = ctx.particles.update(dt, time);

      if (deps.gameStateRef.current === 'playing') {
        let isMoving = false;
        let jump = false;

        const liftSpeed = WORLD_CONFIG.LIFT_SPEED;
        ctx.lift.update(dt, liftSpeed);

        if (deps.wasmCoreRef.current && deps.wasmModuleRef.current) {
            const core = deps.wasmCoreRef.current;
            const iState = ctx.input.getState();

            if (iState.action) deps.performDigging();
            if (iState.toggleLight) { deps.flashlightOn.current = deps.flashlightOn.current > 0.5 ? 0.0 : 1.0; }
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
                ctx.holesArray,
                ctx.numHoles
            );
            
            ctx.player.pos = nextState.pos;
            ctx.player.vel = nextState.vel;
            
            core.setPosition(ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z, ctx.player.vel.y);

            let currentSpeed = isMoving ? 1.0 : 0.0;
            const lerpFactor = Math.min(1.0, dt * 15.0);
            deps.bobTime.current = deps.bobTime.current * (1.0 - lerpFactor) + currentSpeed * lerpFactor;
            deps.walkCycleTime.current += dt * 8.0 * currentSpeed;
            deps.uTimeRef.current = time * 0.001;
        }

        const dxCh = ctx.player.pos.x;
        const dyCh = ctx.player.pos.y + 499.2;
        const dzCh = ctx.player.pos.z;
        if (dxCh*dxCh + dyCh*dyCh + dzCh*dzCh < 4.0 && !deps.hasWonRef.current) {
            deps.hasWonRef.current = true;
            deps.setHasWon(true);
        }

        if (isMoving && ctx.player.vel.y === 0) {
            if (deps.walkCycleTime.current > 4.0) {
                ctx.audio.playStepSound();
                deps.walkCycleTime.current = 0;
            }
        }

        ctx.audio.updateListener(ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z, camDirX, camDirY, camDirZ);
        ctx.audio.updateAmbient(ctx.player.pos.y);

        const fwd = { x: sy * cp, y: sp, z: cy * cp };
        const right = { x: cy, y: 0, z: -sy };
        const up = { x: -sy * sp, y: cp, z: -cy * sp };
        
        const newPlayerUI = ctx.otherPlayers.interpolateAndProject(dt, 8.0, ctx.player, { fwd, right, up });
        if (frameCounter % 5 === 0) deps.setPlayerUI(newPlayerUI);

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
        ctx.player.yaw += dt * 0.1;
        ctx.player.pos = new vec3(-8.0, 3.5, 20.0);
        deps.uTimeRef.current = time * 0.001;
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
          ctx.network.broadcastPosition(ctx.player);
          lastBroadcastTime = time;
      }

      if (deps.rendererRef.current) {
        deps.rendererRef.current.render({
          time: deps.uTimeRef.current,
          camPos: ctx.player.pos,
          camDirX, camDirY, camDirZ,
          camUpX: -sy * sp, camUpY: cp, camUpZ: -cy * sp,
          camRightX: -cy, camRightY: 0, camRightZ: sy,
          holesArray: ctx.holesArray,
          numHoles: ctx.numHoles,
          holeVersion: ctx.holeRingIndex,
          flashlightOn: deps.flashlightOn.current,
          otherPlayersArray: ctx.otherPlayers.otherPlayersArray,
          otherColorsArray: ctx.otherPlayers.otherColorsArray,
          numOtherPlayers: ctx.otherPlayers.numOtherPlayers,
          bobTime: deps.bobTime.current,
          walkCycleTime: deps.walkCycleTime.current,
          liftY: ctx.lift.y,
          petalsArray: ctx.particles.petalsArray,
          activePetals,
          performanceMode: deps.tripleBufferingRef.current ? 1 : 0, 
          maxDistance: deps.renderScaleRef.current < 0.75 ? 150.0 : (deps.renderScaleRef.current < 1.0 ? 180.0 : 250.0)
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

