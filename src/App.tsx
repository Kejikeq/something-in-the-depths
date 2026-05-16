/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Pickaxe, Flashlight, Unplug, Zap, LogOut, VolumeX, Volume2, Link } from 'lucide-react';
import { EngineContext } from './core/EngineContext';
import { VoxelEngine, vec3 } from './core/VoxelEngine';
import { MainMenu } from './components/overlay/MainMenu';

import { HUDOverlay } from './components/overlay/HUDOverlay';
import { WinScreen } from './components/overlay/WinScreen';
import { ChatOverlay } from './components/overlay/ChatOverlay';
import { useGameLoop } from './core/useGameLoop';
import { useWasmCore } from './core/useWasmCore';
import { PlayerUIData } from './components/overlay/HUDOverlay';
import { Player } from './core/Player';
import { InputManager } from './core/InputManager';
import { LiftManager } from './core/LiftManager';
import { ParticleManager } from './core/ParticleManager';
import { OtherPlayersManager } from './core/OtherPlayersManager';

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
  const [renderScale, setRenderScale] = useState(() => window.innerWidth < 768 ? 0.75 : 1.0);
  const renderScaleRef = useRef(renderScale);
  const [flashlightState, setFlashlightState] = useState(true);
  
  const [digSizeIndex, setDigSizeIndex] = useState(1); // 0: small, 1: regular, 2: large
  const digRadii = [1.5, 3.5, 7.0];
  const digSizeIndexRef = useRef(1);

  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    digSizeIndexRef.current = digSizeIndex;
  }, [digSizeIndex]);

  const engineRef = useRef<EngineContext>(new EngineContext());
  const ctx = engineRef.current;

  useEffect(() => {
    renderScaleRef.current = renderScale;
  }, [renderScale]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
        if (gameStateRef.current === 'playing') {
            // User: "down only small [index 0], up to large [index 2]"
            // Scroll down (deltaY > 0) -> step -1
            // Scroll up (deltaY < 0) -> step +1
            const step = e.deltaY > 0 ? -1 : 1;
            setDigSizeIndex(prev => Math.max(0, Math.min(2, prev + step)));
        }
    };
    window.addEventListener('wheel', handleWheel);
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  const [tripleBuffering, setTripleBuffering] = useState(true);
  const tripleBufferingRef = useRef(true);
  useEffect(() => {
      tripleBufferingRef.current = tripleBuffering;
      if (rendererRef.current && rendererRef.current.chunkRenderer) {
          rendererRef.current.chunkRenderer.tripleBuffering = tripleBuffering;
      }
  }, [tripleBuffering]);


  
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
  useEffect(() => {
    ctx.network.setPositionGetter(() => ({
      x: ctx.player.pos.x,
      y: ctx.player.pos.y,
      z: ctx.player.pos.z
    }));
  }, []);
  const { wasmCore, wasmModule, getHolesArray } = useWasmCore();
  
  // WASM Hot-Reload Watchdog
  const [wasmVersion, setWasmVersion] = useState(0);
  useEffect(() => {
    let checkInterval: any;
    if (process.env.NODE_ENV !== 'production') {
      const checkVersion = async () => {
        try {
          const res = await fetch('/api/wasm-version');
          if (res.ok) {
            const data = await res.json();
            if (wasmVersion !== 0 && data.version > wasmVersion) {
              console.log("WASM update detected! Reloading core...");
              window.location.reload(); // Simplest way to ensure clean state
            } else if (wasmVersion === 0) {
              setWasmVersion(data.version);
            }
          }
        } catch (e) {}
      };
      checkInterval = setInterval(checkVersion, 3000);
    }
    return () => clearInterval(checkInterval);
  }, [wasmVersion]);

  useEffect(() => { 
    if (wasmCore && wasmModule) {
      ctx.network.setWasmCore(wasmCore, wasmModule);
    }
  }, [wasmCore, wasmModule]);
  const wasmCoreRef = useRef<any>(null);
  useEffect(() => { 
      wasmCoreRef.current = wasmCore; 
      if (rendererRef.current && wasmCore) {
          rendererRef.current.setWasmCore(wasmCore);
      }
  }, [wasmCore]);
  const wasmModuleRef = useRef<any>(null);
  useEffect(() => { wasmModuleRef.current = wasmModule; }, [wasmModule]);
  const getHolesArrayRef = useRef(getHolesArray);
  useEffect(() => { getHolesArrayRef.current = getHolesArray; }, [getHolesArray]);

  // --- HIGH-FREQUENCY GAME STATE (Refs) ---
  const lastSafePos = useRef({ x: 0, y: 1.5, z: 0 }); // Used for fast-travel/respawn
  const bobTime = useRef(0);
  const walkCycleTime = useRef(0);
  const uTimeRef = useRef(0);
  const fpsRef = useRef(60);
  const pingRef = useRef(0);

  
  // Rendering engine references
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const rendererRef = useRef<any>(null);
  
  // Lift State
  const [liftTarget, setLiftTarget] = useState(0);
  
  
  
  
  const myIdRef = useRef("");
  const myNumericIdRef = useRef<number>(-1);
  const myColorRef = useRef("#34d399");
  
  const [players, setPlayers] = useState<Array<{ numericId: number, nickname: string, color: string }>>([]);
  const [stats, setStats] = useState<{ totalPlayers: number, rooms: any[] } | null>(null);
  
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

  useEffect(() => {
    return () => {
      ctx.audio.dispose();
    };
  }, []);

  useEffect(() => {
    ctx.audio.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
        ctx.audio.setPaused(document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'playing' && !hasWon) {
        if (e.code === 'Enter') {
          if (!isChatOpen) {
            setIsChatOpen(true);
            ctx.input.reset();
          }
        }
        if (e.code === 'Escape' && isChatOpen) {
          setIsChatOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isChatOpen, hasWon]);

  const gameStateRef = useRef(gameState);
  useEffect(() => {
      gameStateRef.current = gameState;
      ctx.audio.setGameState(gameState);
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
      ctx.network.setCallbacks({
        onInit: (data) => {
          setConnStatus('connected');
          setIsAuthenticating(false);
          setAuthError(null);
          myIdRef.current = data.id;
          myNumericIdRef.current = data.numericId;
          myColorRef.current = data.color;
          
          if (data.players) {
            data.players.forEach((p: any) => {
              ctx.otherPlayers.playerMetadata[p.numericId] = { nickname: p.nickname, color: p.color };
              const idx = ctx.otherPlayers.numericIdToIndex.get(p.numericId);
              if (idx !== undefined && idx < 10) {
                ctx.otherPlayers.syncPlayerColor(idx, p.color);
              }
            });
            setPlayers(data.players);
          }

          ctx.voxelGrid.clear();
          if (data.holes) {
              data.holes.forEach((h: any) => ctx.addHole(h.x, h.y, h.z, h.r));
          }
          if (ctx.chunkRenderer) {
              ctx.chunkRenderer.dirtyAll();
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
          ctx.network.disconnect();
        },
        onPlayerMetadata: (pList) => {
          pList.forEach((p: any) => {
            ctx.otherPlayers.playerMetadata[p.numericId] = { nickname: p.nickname, color: p.color };
            const idx = ctx.otherPlayers.numericIdToIndex.get(p.numericId);
            if (idx !== undefined && idx < 10) {
              ctx.otherPlayers.syncPlayerColor(idx, p.color);
            }
          });
          setPlayers(pList);
        },
        onBinaryUpdate: (buffer) => {
          if (myNumericIdRef.current !== -1) {
             ctx.otherPlayers.handleBinaryUpdate(buffer, myNumericIdRef.current);
          }
        },
        onUpdatePlayers: (players) => {
        },
        onNewHole: (hole) => {
          ctx.addHole(hole.x, hole.y, hole.z, hole.r);
          ctx.audio.playSpatialDig(hole.x, hole.y, hole.z);
        },
        onUpdateVoxels: (_voxels) => {
            // silent
            ctx.chunkRenderer.dirtyAll();
        },
        onSyncVoxels: (_voxels, holes) => {
            ctx.voxelGrid.clear();
            if (holes) {
                holes.forEach((h: any) => ctx.addHole(h.x, h.y, h.z, h.r));
            }
            ctx.chunkRenderer.dirtyAll();
        },
        onChatMessage: (data) => {
          ctx.onChatMessage(data);
        },
        onPing: (ping) => {
          pingRef.current = ping;
        }
      });
      // If already connected, make sure UI is updated
      if (ctx.network.playerId && connStatus === 'disconnected') {
        setConnStatus('connected');
      } else if (!ctx.network.playerId) {
        setConnStatus('connecting');
      }

      return () => {
        ctx.network.disconnect();
        setConnStatus('disconnected');
        setPlayers([]);
        setIsAuthenticating(false);
      };
    }
  }, [gameState, roomId, nickname]);

  const performDigging = useCallback(() => {
    if (Date.now() - digCooldown.current < 250) return;
    
    if (wasmCoreRef.current) {
        const dirX = Math.sin(ctx.player.yaw) * Math.cos(ctx.player.pitch);
        const dirY = Math.sin(ctx.player.pitch); 
        const dirZ = Math.cos(ctx.player.yaw) * Math.cos(ctx.player.pitch);
        
        // Raymarch in TS
        let marchT = 0.5;
        let hitFound = false;
        let hitX = 0, hitY = 0, hitZ = 0;
        const pos = ctx.player.pos;
        
        for (let i = 0; i < 150; i++) {
            const px = pos.x + dirX * marchT;
            const py = pos.y + dirY * marchT;
            const pz = pos.z + dirZ * marchT;
            
            const d = VoxelEngine.getDistance(new vec3(px, py, pz), ctx.lift.y, ctx.voxelGrid.holes);
            
            if (d < 0.01) {
                hitX = px; hitY = py; hitZ = pz;
                hitFound = true;
                break;
            }
            
            marchT += d * 0.95;
            if (marchT > 25.0) break;
        }

        if (hitFound) {
            digCooldown.current = Date.now();
            const r = digRadii[digSizeIndexRef.current];
            ctx.addHole(hitX, hitY, hitZ, r); // Local JS sync
            ctx.audio.playDigSound();
            ctx.network.broadcastDig(hitX, hitY, hitZ, r); // Sync with others
        }
    }
  }, []);

  const toggleLift = useCallback(() => {
    if (nearLiftRef.current) {
        const nextTarget = ctx.lift.toggle();
        setLiftTarget(nextTarget);
        ctx.audio.playStepSound();
    }
  }, []);

  useGameLoop({
    ctx,
    canvasRef, glRef, rendererRef, wasmCoreRef, wasmModuleRef,
    gameStateRef, renderScaleRef, tripleBufferingRef,
    fpsRef, pingRef, bobTime, walkCycleTime, uTimeRef,
    nearLiftRef, nearSignRef, jumpQueuedRef, hasWonRef,
    setHasWon, setPlayerUI, setNearSign, setNearLift, setLiftTarget, setIsLocked, setFlashlightState,
    performDigging, toggleLift,
    digRadii, digSizeIndexRef
  });


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
            ctx.player.pos = new vec3(40, 10, 40); 
            ctx.player.vel = new vec3(0, 0, 0);
            ctx.player.yaw = 0;
            ctx.player.pitch = 0;
            ctx.input.reset();
            setHasWon(false);
            hasWonRef.current = false;
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

      {showDebug && (
        <div className="absolute top-20 left-6 pointer-events-none font-mono text-[10px] text-emerald-400/80 bg-black/40 p-2 border border-emerald-500/20">
          <div>FPS: {fpsRef.current}</div>
        </div>
      )}

      {/* Unified HUD Overlay */}
      <HUDOverlay 
        ctx={ctx}
        gameState={gameState} 
        nearSign={nearSign} 
        nearLift={nearLift} 
        liftTarget={liftTarget}
        playerY={ctx.player.pos.y}
        connStatus={connStatus}
        players={players}
        showPlayers={showPlayers}
        setShowPlayers={setShowPlayers}
        myColor={myColorRef.current}
        nickname={nickname}
        myNumericId={myNumericIdRef.current}
        setGameState={setGameState}
        playerUI={playerUI}
        isAuthenticating={isAuthenticating}
        setIsAuthenticating={setIsAuthenticating}
        roomId={roomId}
        flashlightState={flashlightState}
        digSizeIndex={digSizeIndex}
        setDigSizeIndex={setDigSizeIndex}
        setIsChatOpen={setIsChatOpen}
      />

      <ChatOverlay 
        isOpen={isChatOpen}
        setIsOpen={setIsChatOpen}
        ctx={ctx}
        nickname={nickname}
        setNickname={setNickname}
      />

      {/* Main Menu Overlay */}
      <MainMenu
        ctx={ctx}
        gameState={gameState} setGameState={setGameState}
        roomId={roomId} setRoomId={setRoomId}
        nickname={nickname} setNickname={setNickname}
        isMuted={isMuted} setIsMuted={setIsMuted}
        setIsAuthenticating={setIsAuthenticating}
        setAuthError={setAuthError} authError={authError}
        lastSafePos={lastSafePos}
        setHasWon={setHasWon} hasWonRef={hasWonRef}
        setNearSign={setNearSign} nearSignRef={nearSignRef}
        setNearLift={setNearLift} nearLiftRef={nearLiftRef}
        stats={stats}
        renderScale={renderScale} setRenderScale={setRenderScale}
        tripleBuffering={tripleBuffering} setTripleBuffering={setTripleBuffering}
      />
      <WinScreen 
        hasWon={hasWon} 
        onContinue={() => {
          ctx.player.pos = new vec3(40, 10, 40); 
          ctx.player.vel = new vec3(0, 0, 0);
          ctx.player.yaw = 0;
          ctx.player.pitch = 0;
          ctx.input.reset();
          setHasWon(false);
          hasWonRef.current = false;
          setGameState('menu');
        }}
      />
    </div>
  );
}

