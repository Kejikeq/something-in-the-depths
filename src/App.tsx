/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Pickaxe, Flashlight, Unplug, Zap, LogOut, VolumeX, Volume2, Link } from 'lucide-react';
import { AudioManager } from './core/AudioManager';
import { NetworkClient, GameMessage } from './core/NetworkClient';
import { WorldEngine } from './core/WorldEngine';
import { WebGLRenderer } from './core/WebGLRenderer';
import { useWasmCore } from './core/useWasmCore';
import { InputManager, InputState } from './core/InputManager';
import { MainMenu } from './components/overlay/MainMenu';
import { ConnectionOverlay } from './components/overlay/ConnectionOverlay';

import { WinScreen } from './components/overlay/WinScreen';
import { HUDOverlay } from './components/overlay/HUDOverlay';
import { PlayerOverlays, PlayerUIData } from './components/overlay/PlayerOverlays';


export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputManagerRef = useRef<InputManager | null>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing'>('menu');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState(() => localStorage.getItem('prospector_nick') || '');
  const [isLocked, setIsLocked] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const hasWonRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);
  const [nearSign, setNearSign] = useState(false);
  const nearSignRef = useRef(false);
  const [nearLift, setNearLift] = useState(false);
  const nearLiftRef = useRef(false);
  
  // Rendering settings as state (infrequent changes)
  const [showDebug, setShowDebug] = useState(false);
  
  const [showPlayers, setShowPlayers] = useState(false);
  const [connStatus, setConnStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const connStatusRef = useRef(connStatus);
  useEffect(() => {
    connStatusRef.current = connStatus;
  }, [connStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) setRoomId(roomParam.toUpperCase());
  }, []);

  // --- CORE SYSTEM MANAGERS ---
  const audioManager = useRef<AudioManager>(new AudioManager());
  const networkClient = useRef<NetworkClient>(new NetworkClient());
  useEffect(() => {
    networkClient.current.setPositionGetter(() => ({
      x: camPos.current.x,
      y: camPos.current.y,
      z: camPos.current.z
    }));
  }, []);
  const { wasmCore, wasmModule, getHolesArray } = useWasmCore();
  useEffect(() => { 
    if (wasmCore && wasmModule) {
      networkClient.current.setWasmCore(wasmCore, wasmModule);
    }
  }, [wasmCore, wasmModule]);
  const wasmCoreRef = useRef<any>(null);
  useEffect(() => { wasmCoreRef.current = wasmCore; }, [wasmCore]);
  const wasmModuleRef = useRef<any>(null);
  useEffect(() => { wasmModuleRef.current = wasmModule; }, [wasmModule]);
  const getHolesArrayRef = useRef(getHolesArray);
  useEffect(() => { getHolesArrayRef.current = getHolesArray; }, [getHolesArray]);

  // --- HIGH-FREQUENCY GAME STATE (Refs) ---
  const camPos = useRef({ x: 0, y: 1.5, z: 66 }); 
  const lastSafePos = useRef({ x: 0, y: 1.5, z: 66 });
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const yaw = useRef(3.14); // Facing -Z (towards the pier and lift)
  const pitch = useRef(-0.1); // Looking slightly down
  const bobTime = useRef(0);
  const walkCycleTime = useRef(0);
  const uTimeRef = useRef(0);
  const flashlightOn = useRef(1.0);
  const fpsRef = useRef(60);
  const pingRef = useRef(0);
  const othersState = useRef<Record<string, { 
    prevX: number, prevY: number, prevZ: number,
    targetX: number, targetY: number, targetZ: number,
    lerpT: number, speed: number, cycle: number 
  }>>({});
  
  // Rendering engine references
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const rendererRef = useRef<any>(null);

  // --- PERSISTENT WORLD STATE ---
  const MAX_HOLES = WorldEngine.CONFIG.MAX_HOLES;
  const holesArrayRef = useRef(new Float32Array(MAX_HOLES * 4));
  const numHolesRef = useRef(0);
  const ringIndexRef = useRef(0);
  
  // Petals System
  const MAX_PETALS = 20;
  const petalsDataRef = useRef(Array.from({length: MAX_PETALS}, () => ({
      x: 0, y: -1000, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0,
      active: false
  })));
  const petalsArrayRef = useRef(new Float32Array(MAX_PETALS * 4));

  // Lift State
  const liftYRef = useRef(0);
  const liftTargetYRef = useRef(0);
  const [liftTarget, setLiftTarget] = useState(0);
  
  const otherPlayersArrayRef = useRef(new Float32Array(10 * 4).fill(-1.0));
  const otherColorsArrayRef = useRef(new Float32Array(10 * 3).fill(1.0));
  const numOtherPlayersRef = useRef(0);
  const myIdRef = useRef("");
  const myNumericIdRef = useRef<number>(-1);
  const myColorRef = useRef("#34d399");
  const playerMetadata = useRef<Record<number, { nickname: string, color: string }>>({});
  const [players, setPlayers] = useState<Array<{ numericId: number, nickname: string, color: string }>>([]);
  const [stats, setStats] = useState<{ totalPlayers: number, rooms: any[] } | null>(null);
  const numericIdToIndex = useRef(new Map<number, number>());
  const keysRef = useRef<Record<string, boolean>>({});
  const jumpQueuedRef = useRef(false);

  const [playerUI, setPlayerUI] = useState<PlayerUIData[]>([]);

  const touchState = useRef({
    joystickId: -1,
    joystickStart: { x: 0, y: 0 },
    lookId: -1,
    lookLast: { x: 0, y: 0 },
    moveVec: { x: 0, y: 0 }
  });

  const stepCooldown = useRef(0);
  const digCooldown = useRef(0);

  const syncPlayerColor = useCallback((idx: number, hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    otherColorsArrayRef.current[idx * 3] = r;
    otherColorsArrayRef.current[idx * 3 + 1] = g;
    otherColorsArrayRef.current[idx * 3 + 2] = b;
  }, []);

  const addHole = useCallback((x: number, y: number, z: number, r: number, emit = true) => {
    // If wasmCore is active, update it
    if (wasmCoreRef.current) {
        wasmCoreRef.current.addHole(x, y, z, r);
    }
    
    // Also update JS mirror (which may be WASM memory directly, but we keep JS updated as backup)
    const idx = (ringIndexRef.current % MAX_HOLES) * 4;
    holesArrayRef.current[idx] = x;
    holesArrayRef.current[idx + 1] = y;
    holesArrayRef.current[idx + 2] = z;
    holesArrayRef.current[idx + 3] = r;
    ringIndexRef.current++;
    numHolesRef.current = Math.min(ringIndexRef.current, MAX_HOLES);
    
    if (emit) {
        audioManager.current.playDigSound();
        networkClient.current.broadcastDig(x, y, z, r);
    }
  }, []);

  useEffect(() => {
    return () => {
      audioManager.current.dispose();
    };
  }, []);

  useEffect(() => {
    audioManager.current.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
        audioManager.current.setPaused(document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const gameStateRef = useRef(gameState);
  useEffect(() => {
      gameStateRef.current = gameState;
      audioManager.current.setGameState(gameState);
  }, [gameState]);

  useEffect(() => {
     if (gameState === 'menu') {
        const fetchStats = async () => {
           try {
              const res = await fetch('/api/stats');
              if (res.ok) {
                 const data = await res.json();
                 setStats(data);
              }
           } catch(e) {}
        };
        fetchStats();
        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
     }
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'playing') {
      networkClient.current.setCallbacks({
        onInit: (data) => {
          setConnStatus('connected');
          setIsAuthenticating(false);
          setAuthError(null);
          myIdRef.current = data.id;
          myNumericIdRef.current = data.numericId;
          myColorRef.current = data.color;
          
          if (data.players) {
            data.players.forEach((p: any) => {
              playerMetadata.current[p.numericId] = { nickname: p.nickname, color: p.color };
              const idx = numericIdToIndex.current.get(p.numericId);
              if (idx !== undefined && idx < 10) {
                syncPlayerColor(idx, p.color);
              }
            });
            setPlayers(data.players);
          }

          if (data.holeCount !== undefined) {
             ringIndexRef.current = data.holeCount;
             numHolesRef.current = Math.min(data.holeCount, MAX_HOLES);
             data.holes.forEach((h: any, i: number) => {
               holesArrayRef.current[i * 4] = h.x;
               holesArrayRef.current[i * 4 + 1] = h.y;
               holesArrayRef.current[i * 4 + 2] = h.z;
               holesArrayRef.current[i * 4 + 3] = h.r;
             });
          } else {
             ringIndexRef.current = data.holes.length;
             numHolesRef.current = Math.min(data.holes.length, MAX_HOLES);
             holesArrayRef.current.fill(0);
             data.holes.forEach((h: any, i: number) => {
               if (i >= MAX_HOLES) return;
               holesArrayRef.current[i * 4] = h.x;
               holesArrayRef.current[i * 4 + 1] = h.y;
               holesArrayRef.current[i * 4 + 2] = h.z;
               holesArrayRef.current[i * 4 + 3] = h.r;
             });
          }
        },
        onClose: () => {
          setConnStatus('disconnected');
          setPlayers([]);
          setIsAuthenticating(false);
        },
        onError: () => {
          setConnStatus('disconnected');
          setPlayers([]);
          setIsAuthenticating(false);
        },
        onServerError: (err) => {
          setAuthError(err.message);
          setIsAuthenticating(false);
          setGameState('menu');
          networkClient.current.disconnect();
        },
        onPlayerMetadata: (pList) => {
          pList.forEach((p: any) => {
            playerMetadata.current[p.numericId] = { nickname: p.nickname, color: p.color };
            const idx = numericIdToIndex.current.get(p.numericId);
            if (idx !== undefined && idx < 10) {
              syncPlayerColor(idx, p.color);
            }
          });
          setPlayers(pList);
        },
        onBinaryUpdate: (buffer) => {
          const view = new DataView(buffer);
          const count = view.getUint8(1);
          
          const activeNumericIds = new Set<number>();
          let othersCount = 0;

          for (let i = 0; i < count; i++) {
            const offset = 2 + i * 16;
            const nid = view.getUint32(offset, true);
            const x = view.getFloat32(offset + 4, true);
            const y = view.getFloat32(offset + 8, true);
            const z = view.getFloat32(offset + 12, true);

            if (nid === myNumericIdRef.current) continue;

            activeNumericIds.add(nid);
            
            let playerIdx = numericIdToIndex.current.get(nid);
            if (playerIdx === undefined) {
              for (let j = 0; j < 10; j++) {
                let taken = false;
                for (const val of numericIdToIndex.current.values()) {
                  if (val === j) { taken = true; break; }
                }
                if (!taken) {
                  playerIdx = j;
                  numericIdToIndex.current.set(nid, j);
                  break;
                }
              }
            }

            if (playerIdx !== undefined && playerIdx < 10) {
              othersCount++;
              const nidStr = nid.toString();
              const existing = othersState.current[nidStr];
              
              const meta = playerMetadata.current[nid];
              if (meta) {
                syncPlayerColor(playerIdx, meta.color);
              }

              if (!existing) {
                othersState.current[nidStr] = {
                  prevX: x, prevY: y, prevZ: z,
                  targetX: x, targetY: y, targetZ: z,
                  lerpT: 1.0, speed: 0, cycle: 0
                };
                const bIdx = playerIdx * 4;
                otherPlayersArrayRef.current[bIdx] = x;
                otherPlayersArrayRef.current[bIdx + 1] = y;
                otherPlayersArrayRef.current[bIdx + 2] = z;
                otherPlayersArrayRef.current[bIdx + 3] = 0.0; // Activate immediately
              } else {
                // Calculate current visual position to start next lerp from it
                const t = Math.min(1.0, existing.lerpT);
                const curX = existing.prevX + (existing.targetX - existing.prevX) * t;
                const curY = existing.prevY + (existing.targetY - existing.prevY) * t;
                const curZ = existing.prevZ + (existing.targetZ - existing.prevZ) * t;
                
                const dx = x - existing.targetX;
                const dz = z - existing.targetZ;
                const dist = Math.sqrt(dx*dx + dz*dz);
                const newSpeed = dist > 0.01 ? 1.0 : 0.0;
                
                existing.prevX = curX;
                existing.prevY = curY;
                existing.prevZ = curZ;
                existing.targetX = x;
                existing.targetY = y;
                existing.targetZ = z;
                existing.lerpT = 0;
                existing.speed = newSpeed;
              }
            }
          }

          numOtherPlayersRef.current = othersCount;

          // Cleanup stale players
          for (const [nid, idx] of numericIdToIndex.current.entries()) {
            if (!activeNumericIds.has(nid)) {
              numericIdToIndex.current.delete(nid);
              delete othersState.current[nid.toString()];
              otherPlayersArrayRef.current[idx * 4 + 3] = -1.0; // Mark inactive
            }
          }
        },
        onUpdatePlayers: (players) => {
          // Fallback or handle non-positional player updates if any
          // But our server now sends positions via binary
        },
        onNewHole: (hole) => {
          addHole(hole.x, hole.y, hole.z, hole.r, false);
          audioManager.current.playSpatialDig(hole.x, hole.y, hole.z);
        },
        onSyncHoles: (holes, holeCount) => {
            if (holeCount !== undefined) {
                ringIndexRef.current = holeCount;
                numHolesRef.current = Math.min(holeCount, MAX_HOLES);
                holes.forEach((h: any, i: number) => {
                    holesArrayRef.current[i * 4] = h.x;
                    holesArrayRef.current[i * 4 + 1] = h.y;
                    holesArrayRef.current[i * 4 + 2] = h.z;
                    holesArrayRef.current[i * 4 + 3] = h.r;
                });
            } else {
                ringIndexRef.current = holes.length;
                numHolesRef.current = Math.min(holes.length, MAX_HOLES);
                holesArrayRef.current.fill(0);
                holes.forEach((h: any, i: number) => {
                    if (i >= MAX_HOLES) return;
                    holesArrayRef.current[i * 4] = h.x;
                    holesArrayRef.current[i * 4 + 1] = h.y;
                    holesArrayRef.current[i * 4 + 2] = h.z;
                    holesArrayRef.current[i * 4 + 3] = h.r;
                });
            }
        },
        onPing: (ping) => {
          pingRef.current = ping;
        }
      });
      // If already connected, make sure UI is updated
      if (networkClient.current.playerId && connStatus === 'disconnected') {
        setConnStatus('connected');
      } else if (!networkClient.current.playerId) {
        setConnStatus('connecting');
      }

      // Connection is now triggered manually from the menu to allow for createIfMissing flags
      
      return () => {
        networkClient.current.disconnect();
        setConnStatus('disconnected');
        setPlayers([]);
        setIsAuthenticating(false);
      };
    }
  }, [gameState, roomId, addHole, nickname]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    try {
      rendererRef.current = new WebGLRenderer(canvas);
      glRef.current = rendererRef.current.gl;
    } catch (e) {
      console.error(e);
      return;
    }

    // --- Network and Callbacks (Moved to separate useEffect) ---

    const performDigging = () => {
        if (Date.now() - digCooldown.current < 50) return;
        digCooldown.current = Date.now();
        
        const dirX = Math.sin(yaw.current) * Math.cos(pitch.current);
        const dirY = Math.sin(pitch.current); 
        const dirZ = Math.cos(yaw.current) * Math.cos(pitch.current);
        const roX = camPos.current.x;
        const roY = camPos.current.y;
        const roZ = camPos.current.z;

        if (wasmCoreRef.current) {
            const hole = wasmCoreRef.current.doDig(dirX, dirY, dirZ);
            console.log("WASM doDig returned:", hole);
            if (hole && typeof hole === 'object' && hole.r) {
                console.log("Adding hole:", hole);
                addHole(hole.x, hole.y, hole.z, hole.r);
                audioManager.current.playDigSound();
                networkClient.current.broadcastDig(hole.x, hole.y, hole.z, hole.r);
            }
        }
    };

    (window as any)._performDigging = performDigging;
    (window as any)._toggleLight = () => { flashlightOn.current = flashlightOn.current > 0.5 ? 0.0 : 1.0; };
    (window as any)._performJump = () => { jumpQueuedRef.current = true; };
    const toggleLift = () => {
        if (nearLiftRef.current) {
            const nextTarget = Math.abs(liftTargetYRef.current) < 50 ? -149.0 : 0.0;
            liftTargetYRef.current = nextTarget;
            setLiftTarget(nextTarget);
            audioManager.current.playStepSound();
        }
    };
    
    inputManagerRef.current = new InputManager(canvas);
    
    (window as any)._triggerAction = () => inputManagerRef.current?.virtualAction();
    (window as any)._triggerJump = () => inputManagerRef.current?.virtualJump();
    (window as any)._triggerLight = () => { if (inputManagerRef.current) (inputManagerRef.current as any).triggers.toggleLight = true; }
    (window as any)._triggerInteract = () => { if (inputManagerRef.current) (inputManagerRef.current as any).triggers.interact = true; }

    document.addEventListener('pointerlockchange', () => setIsLocked(document.pointerLockElement === canvas));

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    // Reuse vectors to avoid allocation in render loop
    let lastTime = performance.now();
    const frameInterval = 1000 / 60; // 60 FPS limit
    let frameTimes: number[] = [];
    let lastBroadcastTime = 0;
    let rafId: number;
    let dynamicResScale = 0.75;
    
    // Cache UI elements
    let domFps: HTMLElement | null = null;
    let domPing: HTMLElement | null = null;
    let domDepthDot: HTMLElement | null = null;
    let frameCounter = 0;

    const render = (time: number) => {
      rafId = requestAnimationFrame(render);

      const deltaTime = time - lastTime;
      if (deltaTime < frameInterval) return;
      
      lastTime = time - (deltaTime % frameInterval);
      
      frameCounter++;
      if(!canvas) return;
      const gl = glRef.current;
      if(!gl) return;
      
      const dt = Math.min(deltaTime * 0.001, 0.1); 

      frameTimes.push(time);
      while(frameTimes.length > 0 && frameTimes[0] < time - 1000) frameTimes.shift();
      fpsRef.current = frameTimes.length;

      // Dynamic Resolution Scaling
      if (frameCounter % 30 === 0) {
        if (fpsRef.current < 45) {
          dynamicResScale = Math.max(0.4, dynamicResScale - 0.05);
        } else if (fpsRef.current >= 55) {
          dynamicResScale = Math.min(0.75, dynamicResScale + 0.05);
        }
      }

      const dpr = Math.min(window.devicePixelRatio, 1.5); // Cap DPR for performance
      const targetW = Math.floor(window.innerWidth * dpr * dynamicResScale); 
      const targetH = Math.floor(window.innerHeight * dpr * dynamicResScale);
      if(canvas.width !== targetW || canvas.height !== targetH) {
         canvas.width = targetW; canvas.height = targetH;
         gl.viewport(0, 0, canvas.width, canvas.height);
      }

      const sy = Math.sin(yaw.current), cy = Math.cos(yaw.current), sp = Math.sin(pitch.current), cp = Math.cos(pitch.current);
      const camDirX = sy * cp, camDirY = sp, camDirZ = cy * cp;
      
      const gravity = WorldEngine.CONFIG.GRAVITY;
      const moveSpeed = WorldEngine.CONFIG.MOVE_SPEED;
      const jumpStrength = WorldEngine.CONFIG.JUMP_STRENGTH;

      let activePetals = 0;

      // --- Petals Physics ---
      const treePos = { x: 34.0, y: -1.0, z: -8.0 };
      const windX = Math.cos(time * 0.001) * 2.0;
      const windZ = Math.sin(time * 0.0015) * 1.5;
      
      petalsDataRef.current.forEach((p, i) => {
          if (!p.active) {
              // Random spawn
              if (Math.random() < 0.015) { // very low chance per frame
                  p.active = true;
                  // Spawn inside the canopy
                  p.x = treePos.x + (Math.random() - 0.5) * 6.0;
                  p.y = treePos.y + 7.0 + Math.random() * 2.5; 
                  p.z = treePos.z + (Math.random() - 0.5) * 6.0;
                  p.vx = (Math.random() - 0.5) * 0.5;
                  p.vy = -0.5 - Math.random() * 1.0;
                  p.vz = (Math.random() - 0.5) * 0.5;
                  p.life = 15.0 + Math.random() * 10.0;
              }
          }
          
          if (p.active) {
              // Update physics
              if (p.vy < 0) { // flying
                  p.x += (p.vx + windX) * dt;
                  p.y += p.vy * dt;
                  p.z += (p.vz + windZ) * dt;
                  
                  // Ground check (Check against a simplified terrain SDF)
                  if (p.y < 0.5) {
                      // Basic flat ground
                      let distToGround = p.y;
                      
                      // Abyss
                      const dEntrance = Math.sqrt(p.x*p.x + p.z*p.z) - 28.0;
                      if (dEntrance < 0) distToGround = Math.max(distToGround, -( -p.y - 150.0 ));
                      
                      // Holes
                      for (let i = 0; i < numHolesRef.current; i++) {
                          const hX = holesArrayRef.current[i*4];
                          const hY = holesArrayRef.current[i*4+1];
                          const hZ = holesArrayRef.current[i*4+2];
                          const hR = holesArrayRef.current[i*4+3];
                          const distToHoleSq = (p.x - hX)**2 + (p.y - hY)**2 + (p.z - hZ)**2;
                          if (distToHoleSq < (hR + 2.0)**2) {
                              const hd = Math.sqrt(distToHoleSq) - hR;
                              distToGround = Math.max(distToGround, -hd);
                          }
                      }
                      
                      // Bridge
                      const dBridge = Math.max(Math.abs(p.x) - 1.5, Math.abs(p.y + 0.4) - 0.1, Math.abs(p.z - 16.85) - 12.15);
                      distToGround = Math.min(distToGround, dBridge);

                      // Pier
                      const dxPier = Math.max(Math.abs(p.x) - 2.5, Math.abs(p.y + 0.4) - 0.15, Math.abs(p.z - 55.0) - 15.0);
                      distToGround = Math.min(distToGround, dxPier);
                      
                      if (distToGround < 0.1) {
                          p.vy = 0; // landed
                          p.y -= (distToGround - 0.02); // snap precisely
                      }
                  }
              }
              
                  p.life -= dt;
                  if (p.life <= 0) {
                      p.active = false;
                  } else {
                      petalsArrayRef.current[activePetals * 4] = p.x;
                      petalsArrayRef.current[activePetals * 4 + 1] = p.y;
                      petalsArrayRef.current[activePetals * 4 + 2] = p.z;
                      petalsArrayRef.current[activePetals * 4 + 3] = p.life > 1.0 ? 1.0 : p.life;
                      activePetals++;
                  }
          }
      });

      if (gameStateRef.current === 'playing') {
        let isW = false, isS = false, isA = false, isD = false;
        let isMoving = false;
        let jump = false;

        if (inputManagerRef.current) {
            const iState = inputManagerRef.current.getState();
            if (iState.action) performDigging();
            if (iState.toggleLight) { flashlightOn.current = flashlightOn.current > 0.5 ? 0.0 : 1.0; }
            if (iState.interact) toggleLift();
            
            yaw.current += iState.lookX * 0.002;
            pitch.current -= iState.lookY * 0.002;
            pitch.current = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch.current));

            // WASM engine expects bitmask directions (W = 1, A = 2, S = 4, D = 8)
            isW = iState.moveY > 0.2;
            isS = iState.moveY < -0.2;
            isA = iState.moveX < -0.2;
            isD = iState.moveX > 0.2;
            isMoving = Math.abs(iState.moveX) > 0.1 || Math.abs(iState.moveY) > 0.1;
            jump = iState.jump;
            
            // Joystick visual sync
            const jData = inputManagerRef.current.getJoystickUIData();
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
        }

        let gDist = 0;

        // --- Lift Animation ---
        const liftSpeed = WorldEngine.CONFIG.LIFT_SPEED;
        let liftDeltaY = 0;
        if (Math.abs(liftYRef.current - liftTargetYRef.current) > 0.01) {
            const maxDelta = Math.abs(liftTargetYRef.current - liftYRef.current);
            liftDeltaY = Math.sign(liftTargetYRef.current - liftYRef.current) * Math.min(liftSpeed * dt, maxDelta);
            liftYRef.current += liftDeltaY;
        } else {
            liftYRef.current = liftTargetYRef.current;
        }

        if (wasmCoreRef.current && wasmModuleRef.current) {
            const core = wasmCoreRef.current;
            
            let bitmask = 0;
            if (isW) bitmask |= 1;
            if (isA) bitmask |= 2;
            if (isS) bitmask |= 4;
            if (isD) bitmask |= 8;
            
            core.setCameraOrientation(yaw.current, pitch.current);
            core.setLiftY(liftYRef.current);
            
            // Advance WASM simulation
            core.update(dt, bitmask, jump);
            
            // Sync player position from WASM back to React State / WebGL
            const pState = core.getPlayerState();
            camPos.current.x = pState.x;
            camPos.current.y = pState.y;
            camPos.current.z = pState.z;
            
            // Sync Holes from shared WASM memory to TypedArray for WebGL shader
            const rawHoles = getHolesArrayRef.current(core, wasmModuleRef.current);
            if (rawHoles) {
                holesArrayRef.current = rawHoles;
            }
            numHolesRef.current = core.getNumHoles();

            gDist = pState.gDist;

            // Optional bob and walk cycle timing sync
            let currentSpeed = isMoving ? 1.0 : 0.0;
            const lerpFactor = Math.min(1.0, dt * 15.0);
            bobTime.current = bobTime.current * (1.0 - lerpFactor) + currentSpeed * lerpFactor;
            walkCycleTime.current += dt * 8.0 * currentSpeed;
            uTimeRef.current = time * 0.001;
        }

        // Treasure Chest Collection at depth -500
        const dxCh = camPos.current.x;
        const dyCh = camPos.current.y + 499.2;
        const dzCh = camPos.current.z;
        if (dxCh*dxCh + dyCh*dyCh + dzCh*dzCh < 4.0 && !hasWonRef.current) {
            hasWonRef.current = true;
            setHasWon(true);
        }

        // Step sounds
        if (isMoving && gDist < 0.2) {
            stepCooldown.current -= dt;
            if (stepCooldown.current <= 0) {
                audioManager.current.playStepSound();
                stepCooldown.current = 0.4;
            }
        }

        audioManager.current.updateListener(camPos.current.x, camPos.current.y, camPos.current.z, camDirX, camDirY, camDirZ);
        audioManager.current.updateAmbient(camPos.current.y);

        // --- Other Players Visual Interpolation ---
        // We target 120ms (0.12s) for interpolation to buffer against network jitter
        const interpSpeed = 8.0; 
        const otherStates = othersState.current;
        const newPlayerUI: any[] = [];
        
        // Use existing camera vectors from top of render loop
        const fwd = { x: sy * cp, y: sp, z: cy * cp };
        const right = { x: cy, y: 0, z: -sy };
        const up = { x: -sy * sp, y: cp, z: -cy * sp };

        for (const nidStr in otherStates) {
          const state = otherStates[nidStr] as any;
          const nid = parseInt(nidStr);
          const idx = numericIdToIndex.current.get(nid);
          if (idx !== undefined && idx < 10) {
            state.lerpT = Math.min(1.0, state.lerpT + dt * interpSpeed);
            const t = state.lerpT;
            const x = state.prevX + (state.targetX - state.prevX) * t;
            const y = state.prevY + (state.targetY - state.prevY) * t;
            const z = state.prevZ + (state.targetZ - state.prevZ) * t;
            
            const baseIdx = idx * 4;
            otherPlayersArrayRef.current[baseIdx] = x;
            otherPlayersArrayRef.current[baseIdx + 1] = y;
            otherPlayersArrayRef.current[baseIdx + 2] = z;
            
            const curVisualSpeed = otherPlayersArrayRef.current[baseIdx + 3];
            otherPlayersArrayRef.current[baseIdx + 3] = curVisualSpeed * (1.0 - Math.min(1.0, dt * 10.0)) + state.speed * Math.min(1.0, dt * 10.0);

            // --- Project to screen for tags and arrows ---
            const meta = playerMetadata.current[nid];
            if (meta) {
               // Player head position
               const tagPos = { x, y: y + 0.5, z };
               const rel = { x: tagPos.x - camPos.current.x, y: tagPos.y - camPos.current.y, z: tagPos.z - camPos.current.z };
               
               // View space transform
               const viewZ = rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z;
               const viewX = rel.x * right.x + rel.y * right.y + rel.z * right.z;
               const viewY = rel.x * up.x + rel.y * up.y + rel.z * up.z;
               
               const dist = Math.sqrt(rel.x*rel.x + rel.y*rel.y + rel.z*rel.z);
               
               // FOV scaling (approximate for perspective)
               const fov = 1.0; 
               const screenX = (viewX / (viewZ * fov)) * 0.5 + 0.5;
               const screenY = 0.5 - (viewY / (viewZ * fov)) * 0.5;

               const offScreen = viewZ <= 0.1 || screenX < 0.05 || screenX > 0.95 || screenY < 0.05 || screenY > 0.95;
               const angle = Math.atan2(viewX, -viewY); // -viewY because screen Y is inverted

               newPlayerUI.push({
                 nid,
                 nickname: meta.nickname,
                 color: meta.color,
                 screenX: screenX * 100,
                 screenY: screenY * 100,
                 visible: true,
                 dist,
                 offScreen,
                 angle
               });
            }
          }
        }
        if (frameCounter % 5 === 0) setPlayerUI(newPlayerUI);

        // Check for sign proximity
        const dxS = camPos.current.x - (-3.0);
        const dzS = camPos.current.z - 28.0;
        const distS = Math.sqrt(dxS*dxS + dzS*dzS);
        const isNearSignNow = distS < 3.0 && camPos.current.y > 0.0;
        
        if (isNearSignNow !== nearSignRef.current) {
          nearSignRef.current = isNearSignNow;
          setNearSign(isNearSignNow);
        }

        // Check for lift proximity (void area z=2.5)
        const dxL = camPos.current.x - 0.0;
        const dzL = camPos.current.z - 2.5;
        const distL = Math.sqrt(dxL*dxL + dzL*dzL);
        
        // Interaction is possible if near the lift platform OR at the main stations (top/bottom)
        const isAtTop = Math.abs(camPos.current.y) < 3.0;
        const isAtBottom = Math.abs(camPos.current.y + 150.0) < 3.0;
        const isNearPlatform = Math.abs(camPos.current.y - liftYRef.current) < 3.0;
        
        const isNearLiftNow = distL < 5.0 && (isNearPlatform || isAtTop || isAtBottom);
        
        if (isNearLiftNow !== nearLiftRef.current) {
            nearLiftRef.current = isNearLiftNow;
            setNearLift(isNearLiftNow);
        }

      } else {
        yaw.current += dt * 0.1;
        camPos.current = { x: -8.0, y: 3.5, z: 20.0 };
        uTimeRef.current = time * 0.001;
      }
      
      // Update UI (Throttled and cached to save DOM layout thrashing)
      if (frameCounter % 10 === 0) {
          if (!domDepthDot) domDepthDot = document.getElementById('player-depth-dot');
          if (domDepthDot) {
              const depthPercent = Math.min(100, (Math.abs(camPos.current.y) / 500) * 100);
              domDepthDot.style.top = `${depthPercent}%`;
          }

          if (!domFps) domFps = document.getElementById('ui-fps');
          if (domFps) domFps.innerText = `FPS: ${fpsRef.current}`;

          if (!domPing) domPing = document.getElementById('ui-ping');
          if (domPing) {
              if (connStatusRef.current === 'connected') {
                domPing.innerText = `PING: ${pingRef.current} MS`;
              } else if (connStatusRef.current === 'connecting') {
                domPing.innerText = 'CONNECTING...';
              } else {
                domPing.innerText = 'DISCONNECTED';
              }
          }
      }

      if (rendererRef.current) {
        rendererRef.current.render({
          time: uTimeRef.current,
          camPos: camPos.current,
          camDirX, camDirY, camDirZ,
          camUpX: -sy * sp, camUpY: cp, camUpZ: -cy * sp,
          camRightX: cy, camRightY: 0, camRightZ: -sy,
          holesArray: holesArrayRef.current,
          numHoles: numHolesRef.current,
          flashlightOn: flashlightOn.current,
          otherPlayersArray: otherPlayersArrayRef.current,
          otherColorsArray: otherColorsArrayRef.current,
          numOtherPlayers: numOtherPlayersRef.current,
          bobTime: bobTime.current,
          walkCycleTime: walkCycleTime.current,
          liftY: liftYRef.current,
          petalsArray: petalsArrayRef.current,
          activePetals
        });
      }
    };
    
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      
      if (rendererRef.current) {
        rendererRef.current.destroy();
      }
      if (inputManagerRef.current) {
        inputManagerRef.current.dispose();
      }
    };
  }, []);


  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none touch-none">
      <canvas 
        ref={canvasRef} 
        style={{ width: '100vw', height: '100vh', display: 'block', imageRendering: 'pixelated' }}
      />
      
      {/* UI Overlay */}
      <div className="absolute top-6 left-6 flex gap-4 items-center pointer-events-none z-[60]">
        <button 
          onClick={() => {
            camPos.current = { x: 0, y: 10, z: 66 }; // High spawn trigger
            setGameState('menu');
          }}
          className="p-3 rounded-xl bg-black/40 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-all pointer-events-auto"
          title="Quit to Menu"
        >
          <LogOut size={20} />
        </button>
                <div className="text-emerald-500/60 font-mono text-[10px] uppercase tracking-widest mt-1">Signal: {roomId || 'Global'}</div>
                <button 
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('room', roomId);
                    navigator.clipboard.writeText(url.toString());
                    setShowCopied(true);
                    setTimeout(() => setShowCopied(false), 2000);
                  }}
                  className="p-2 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-all pointer-events-auto flex items-center gap-2 text-[10px] uppercase font-mono tracking-tighter"
                >
                  <Link size={14} />
                  {showCopied ? 'COPIED!' : 'Copy Link'}
                </button>
              </div>

      {/* PC Interaction Prompt */}
      {isLocked && nearLift && (
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mt-16 pointer-events-none z-50 text-emerald-400 font-mono text-sm uppercase bg-black/60 px-4 py-2 border border-emerald-500/30 hidden sm:block shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            [E] {liftTarget === 0 ? 'GO DOWN' : 'GO UP'}
         </div>
      )}

      {/* Network & Performance Stats */}
      <div className="absolute top-6 right-6 flex flex-col items-end pointer-events-none font-mono text-[10px] tracking-widest uppercase gap-4 z-[60]">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${connStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : connStatus === 'connecting' ? 'bg-amber-400 animate-spin' : 'bg-red-500'}`} />
            <div id="ui-ping" className={`${connStatus === 'connected' ? 'text-emerald-400' : 'text-white/40'}`}>
              {connStatus === 'connected' ? `PING: -- MS` : connStatus === 'connecting' ? 'CONNECTING...' : 'DISCONNECTED'}
            </div>
          </div>
          <div id="ui-fps" className="text-emerald-400/40">FPS: --</div>
        </div>
        
        {gameState === 'playing' && (
          <div className="flex flex-col items-end pointer-events-auto">
            <button 
              onClick={() => setShowPlayers(!showPlayers)}
              className="flex items-center gap-2 px-2 py-1 bg-black/40 border border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10 transition-all text-[9px] rounded-sm"
            >
              <span>{players.length || (connStatus === 'connected' ? 1 : 0)} PROSPECTORS</span>
              <span className="opacity-40">{showPlayers ? '▲' : '▼'}</span>
            </button>
            
            {showPlayers && (
              <div className="mt-2 flex flex-col gap-1 items-end bg-black/60 backdrop-blur-md p-2 border border-emerald-500/20 min-w-[140px] animate-in fade-in slide-in-from-top-1">
                <div className="text-emerald-500/40 text-[8px] mb-1 border-b border-emerald-500/10 w-full text-right pb-1">SIGNAL STREAM</div>
                
                {players.length === 0 && connStatus === 'connected' && (
                   <div className="flex items-center gap-2 px-2 py-0.5 w-full justify-end group transition-all hover:bg-emerald-500/5">
                      <span className="text-white/20 text-[7px]">(YOU)</span>
                      <span className="font-bold tracking-tighter" style={{ color: myColorRef.current }}>{nickname || 'Prospector'}</span>
                      <div className="w-1 h-3 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: myColorRef.current, color: myColorRef.current }} />
                   </div>
                )}

                {players.map(p => (
                  <div key={p.numericId} className="flex items-center gap-2 px-2 py-0.5 w-full justify-end group transition-all hover:bg-emerald-500/5">
                    {p.numericId === myNumericIdRef.current && <span className="text-white/20 text-[7px]">(YOU)</span>}
                    <span className="font-bold tracking-tighter" style={{ color: p.color }}>{p.nickname}</span>
                    <div className="w-1 h-3 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: p.color, color: p.color }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {connStatus === 'disconnected' && (
           <button 
             onClick={() => {
                setGameState('menu'); 
                // Alternatively, force a reconnect by toggling playing state or just clicking Join again in menu
             }}
             className="px-4 py-2 bg-red-500/20 border border-red-500 text-red-500 text-[10px] pointer-events-auto hover:bg-red-500/40 transition-all rounded"
           >
             RETURN TO TERMINAL
           </button>
        )}
      </div>



      {showDebug && (
        <div className="absolute top-20 left-6 pointer-events-none font-mono text-[10px] text-emerald-400/80 bg-black/40 p-2 border border-emerald-500/20">
          <div>FPS: {fpsRef.current}</div>
        </div>
      )}

      {/* Depth Indicator Overlay */}
      <div className={`${gameState === 'menu' ? 'hidden' : 'flex'} absolute left-8 top-1/2 -translate-y-1/2 flex items-center z-50 pointer-events-none`}>
        <div className="relative w-2 sm:w-3 h-80 bg-slate-900/60 border border-emerald-900/30 backdrop-blur-sm shadow-inner rounded-full overflow-hidden">
          {/* Biome markers background */}
          <div className="absolute top-0 w-full h-[24%] bg-amber-900/20" /> {/* Earth */}
          <div className="absolute top-[28%] w-full h-[20%] bg-emerald-900/30" /> {/* Jungle */}
          <div className="absolute top-[52%] w-full h-[20%] bg-indigo-900/30" /> {/* Mushrooms */}
          <div className="absolute top-[76%] w-full h-[24%] bg-slate-950" /> {/* ??? */}
          
          {/* Player Dot */}
          <div 
            id="player-depth-dot"
            className="absolute left-1/2 -translate-x-1/2 w-2 h-2 sm:w-3 sm:h-3 bg-emerald-400 rounded-full shadow-[0_0_12px_white] transition-all duration-300 pointer-events-none z-10"
            style={{ top: '0%' }}
          />
        </div>

        {/* Vertical Biome Labels */}
        <div className="ml-3 sm:ml-4 flex flex-col justify-between h-80 py-4 font-mono text-[8px] sm:text-[10px] tracking-tight uppercase select-none opacity-60">
           <span className="text-amber-500 transform rotate-180 [writing-mode:vertical-lr]">Earth</span>
           <span className="text-emerald-500 transform rotate-180 [writing-mode:vertical-lr]">Jungle</span>
           <span className="text-indigo-400 transform rotate-180 [writing-mode:vertical-lr]">Mushrooms</span>
           <span className="text-slate-600 transform rotate-180 [writing-mode:vertical-lr]">???</span>
        </div>
      </div>

      {/* Quality buttons removed */}
      
      {/* Connection Overlay */}
      <ConnectionOverlay 
        isAuthenticating={isAuthenticating}
        setIsAuthenticating={setIsAuthenticating}
        roomId={roomId}
        connStatus={connStatus}
        setGameState={setGameState}
        networkClient={networkClient}
      />

      <HUDOverlay 
        gameState={gameState} 
        nearSign={nearSign} 
        nearLift={nearLift} 
        liftTarget={liftTarget} 
      />

      {/* Main Menu Overlay */}
      <MainMenu
        gameState={gameState} setGameState={setGameState}
        roomId={roomId} setRoomId={setRoomId}
        nickname={nickname} setNickname={setNickname}
        isMuted={isMuted} setIsMuted={setIsMuted}
        audioManager={audioManager}
        setIsAuthenticating={setIsAuthenticating}
        setAuthError={setAuthError} authError={authError}
        camPos={camPos} lastSafePos={lastSafePos}
        yaw={yaw} pitch={pitch} velocity={velocity}
        setHasWon={setHasWon} hasWonRef={hasWonRef}
        setNearSign={setNearSign} nearSignRef={nearSignRef}
        setNearLift={setNearLift} nearLiftRef={nearLiftRef}
        networkClient={networkClient} stats={stats}
      />
      <WinScreen hasWon={hasWon} />

      <PlayerOverlays gameState={gameState} playerUI={playerUI} />
    </div>
  );
}

