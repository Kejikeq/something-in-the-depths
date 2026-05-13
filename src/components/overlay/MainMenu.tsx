import React, { useState } from 'react';
import { VolumeX, Volume2, Settings } from 'lucide-react';
import { EngineContext } from '../../core/EngineContext';
import { vec3 } from '../../core/VoxelEngine';

interface MainMenuProps {
  ctx: EngineContext;
  gameState: 'menu' | 'playing';
  setGameState: (state: 'menu' | 'playing') => void;
  roomId: string;
  setRoomId: (id: string) => void;
  nickname: string;
  setNickname: (nick: string) => void;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAuthenticating: (auth: boolean) => void;
  setAuthError: (error: string | null) => void;
  authError: string | null;
  lastSafePos: React.MutableRefObject<any>;
  setHasWon: (won: boolean) => void;
  hasWonRef: React.MutableRefObject<boolean>;
  setNearSign: (n: boolean) => void;
  nearSignRef: React.MutableRefObject<boolean>;
  setNearLift: (l: boolean) => void;
  nearLiftRef: React.MutableRefObject<boolean>;
  stats: any;
  renderScale: number;
  setRenderScale: (scale: number) => void;
  tripleBuffering: boolean;
  setTripleBuffering: (val: boolean) => void;
}

export function MainMenu({
  ctx, gameState, setGameState, roomId, setRoomId, nickname, setNickname,
  isMuted, setIsMuted, setIsAuthenticating, setAuthError, authError,
  lastSafePos,
  setHasWon, hasWonRef, setNearSign, nearSignRef, setNearLift, nearLiftRef,
  stats, renderScale, setRenderScale,
  tripleBuffering, setTripleBuffering
}: MainMenuProps) {
  const [showSettings, setShowSettings] = useState(false);

  if (gameState !== 'menu') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md">
      <div className="absolute top-4 right-4 flex gap-2">
        <button 
          onClick={() => setShowSettings(!showSettings)} 
          className="p-2 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-all pointer-events-auto"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button 
          onClick={() => {
            setIsMuted((m: boolean) => !m);
            ctx.audio.init();
            ctx.audio.resume();
          }} 
          className="p-2 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-all pointer-events-auto"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
      <div className="max-w-md w-full p-6 sm:p-8 border border-emerald-500/20 bg-emerald-950/5 flex flex-col items-center gap-6">
        <div className="text-center group">
          <h2 className="font-mono flex items-baseline justify-center gap-2 sm:gap-4 select-none">
            <span className="text-3xl sm:text-5xl font-black text-black drop-shadow-[0_0_15px_rgba(52,211,153,0.5)] tracking-tighter uppercase">Something</span>
            <span className="text-[8px] sm:text-[10px] text-emerald-500/40 uppercase tracking-widest leading-none pb-1 sm:pb-2">in the</span>
            <span className="text-3xl sm:text-5xl font-black text-black drop-shadow-[0_0_15px_rgba(52,211,153,0.5)] tracking-tighter uppercase">Depths</span>
          </h2>
          <p className="text-emerald-600/30 font-mono text-[8px] uppercase tracking-[0.8em] mt-2 opacity-50">Authorized Personnel Only</p>
        </div>

        {showSettings ? (
            <div className="w-full flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
                <div className="text-emerald-400 font-mono text-xs uppercase tracking-widest text-center border-b border-emerald-500/20 pb-2">Hardware Configuration</div>
                
                {/* Graphics Quality */}
                <div className="flex flex-col gap-1.5">
                    <div className="text-emerald-500/40 text-[7px] uppercase tracking-[0.2em] mb-0.5">Graphics Quality</div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setRenderScale(0.5)} className={`flex-1 py-1 font-mono text-[10px] uppercase border transition-all ${renderScale === 0.5 ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'bg-black/60 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10'}`}>Low</button>
                        <button onClick={() => setRenderScale(0.75)} className={`flex-1 py-1 font-mono text-[10px] uppercase border transition-all ${renderScale === 0.75 ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'bg-black/60 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10'}`}>Med</button>
                        <button onClick={() => setRenderScale(1.0)} className={`flex-1 py-1 font-mono text-[10px] uppercase border transition-all ${renderScale === 1.0 ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'bg-black/60 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10'}`}>High</button>
                    </div>
                </div>

                {/* Buffering Mode */}
                <div className="flex flex-col gap-1.5">
                    <div className="text-emerald-500/40 text-[7px] uppercase tracking-[0.2em] mb-0.5">Chunk Buffering</div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setTripleBuffering(false)} className={`flex-1 py-1 font-mono text-[10px] border transition-all ${!tripleBuffering ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'bg-black/60 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10'}`}>Double</button>
                        <button onClick={() => setTripleBuffering(true)} className={`flex-1 py-1 font-mono text-[10px] border transition-all ${tripleBuffering ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'bg-black/60 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10'}`}>Triple</button>
                    </div>
                    <p className="text-emerald-600/40 text-[7px] font-mono leading-tight mt-1">Triple buffering caches pending chunks to reduce visual stutter during complex procedural generation.</p>
                </div>

                <button onClick={() => setShowSettings(false)} className="w-full py-2 mt-2 bg-black border border-emerald-500/40 text-emerald-500 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-emerald-500/20 transition-all">Back</button>
            </div>
        ) : (
          <div className="w-full flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
            <label className="text-emerald-500/40 font-mono text-[8px] uppercase tracking-widest text-center">Identifying Signal</label>
            <input 
              type="text" 
              placeholder="NICKNAME"
              maxLength={12}
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toUpperCase())}
              className="w-full bg-black/80 border border-cyan-500/20 p-3 text-cyan-400 font-mono outline-none focus:border-cyan-500/50 transition-all uppercase placeholder:text-cyan-950 text-center tracking-widest text-xs"
            />
          </div>

          <button 
            onClick={() => {
              const id = Math.random().toString(36).substring(7).toUpperCase();
              setRoomId(id);
              if (nickname) localStorage.setItem('prospector_nick', nickname);
              setIsAuthenticating(true);
              setAuthError(null);
              const spawnX = 0, spawnZ = 66;
              const groundY = 0;
              ctx.player.pos = new vec3(spawnX, groundY + 1.5, spawnZ);
              lastSafePos.current = { x: spawnX, y: groundY + 1.5, z: spawnZ };
              ctx.player.yaw = 3.14;
              ctx.player.pitch = -0.1;
              ctx.player.vel = new vec3(0, 0, 0);
              setHasWon(false);
              hasWonRef.current = false;
              setNearSign(false);
              nearSignRef.current = false;
              setNearLift(false);
              nearLiftRef.current = false;
              setGameState('playing');
              setTimeout(() => {
                  ctx.network.connect(id, nickname, true); // Create allowed
              }, 100);
            }}
            className="w-full py-4 bg-emerald-500 text-black font-mono font-bold tracking-[0.2em] hover:bg-emerald-400 active:scale-[0.98] transition-all uppercase outline-none shadow-[0_0_20px_rgba(16,185,129,0.3)] text-sm"
          >
            Start New Expedition
          </button>
          
          <div className="w-full h-px bg-emerald-500/10 my-2" />

          <div className="flex flex-col gap-1.5">
            <label className="text-emerald-500/40 font-mono text-[8px] uppercase tracking-widest text-center">Join Existing Frequency</label>
            <div className="flex items-center gap-2">
                <input 
                type="text" 
                placeholder="ID"
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value.toUpperCase());
                  setAuthError(null);
                }}
                className="w-28 sm:w-32 bg-black/80 border border-emerald-500/20 p-3 text-emerald-400 font-mono outline-none focus:border-emerald-500/50 transition-all uppercase placeholder:text-emerald-950 text-center tracking-widest text-xs"
                />
                <button 
                onClick={() => {
                    if (roomId.trim()) {
                        if (nickname) localStorage.setItem('prospector_nick', nickname);
                        setIsAuthenticating(true);
                        setAuthError(null);
                        const spawnX = 0, spawnZ = 66;
                        const groundY = 0;
                        ctx.player.pos = new vec3(spawnX, groundY + 1.5, spawnZ);
                        lastSafePos.current = { x: spawnX, y: groundY + 1.5, z: spawnZ };
                        ctx.player.yaw = 3.14;
                        ctx.player.pitch = -0.1;
                        ctx.player.vel = new vec3(0, 0, 0);
                        setHasWon(false);
                        hasWonRef.current = false;
                        setNearSign(false);
                        nearSignRef.current = false;
                        setNearLift(false);
                        nearLiftRef.current = false;
                        setGameState('playing');
                        setTimeout(() => {
                            ctx.network.connect(roomId, nickname, false); // Create NOT allowed
                        }, 50);
                    }
                }}
                className="flex-1 py-3 border border-emerald-500/40 text-emerald-500 font-mono hover:bg-emerald-500/20 active:scale-[0.95] transition-all uppercase tracking-widest text-xs"
                >
                Join
                </button>
            </div>
            {authError && <div className="text-red-500/80 font-mono text-[8px] mt-1 text-center uppercase tracking-widest animate-pulse">{authError}</div>}
          </div>

          <div className="flex flex-col gap-1.5 mt-2">
            <div className="text-emerald-500/40 text-[7px] uppercase tracking-[0.2em] mb-0.5 text-center">Global Spectrum</div>
            <div className="flex items-center justify-between bg-black/60 border border-emerald-500/10 p-2 px-3">
                <span className="text-emerald-500/60 text-[8px] uppercase tracking-widest">Active Prospectors</span>
                <span className="text-emerald-400 font-mono text-[10px]">{stats?.totalPlayers || 0}</span>
            </div>
            {stats && stats.rooms?.length > 0 && (
                <div className="flex flex-col gap-1 mt-1 max-h-24 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-emerald-500/20">
                  {stats.rooms.filter((r: any) => r.id !== 'global').map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-[7px] uppercase tracking-tighter opacity-40 hover:opacity-100 transition-opacity">
                        <span className="font-mono">{r.id}</span>
                        <span>{r.players} SGNL</span>
                    </div>
                  ))}
                </div>
            )}
          </div>

          <div className="text-emerald-500/30 text-[8px] font-mono text-center mt-6 space-y-1 border-t border-emerald-500/5 pt-4">
            <p>WASD: LOCOMOTION | SPACE: JUMP | MOUSE: ROTATION</p>
            <p>CLICK / TAP: EXCAVATE | F: ILLUMINATION</p>
            <p className="text-cyan-400/60 animate-pulse uppercase">Objective: Descend to the void</p>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
