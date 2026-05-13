import React from 'react';
import { Pickaxe, Zap, Flashlight } from 'lucide-react';
import { EngineContext } from '../../core/EngineContext';

export interface PlayerUIData {
  nid: number;
  nickname: string;
  color: string;
  screenX: number;
  screenY: number;
  dist: number;
  visible: boolean;
  offScreen: boolean;
  angle: number;
}

interface HUDOverlayProps {
  ctx: EngineContext;
  gameState: 'menu' | 'playing';
  nearSign: boolean;
  nearLift: boolean;
  liftTarget: number;
  playerY: number;
  connStatus: 'disconnected' | 'connecting' | 'connected';
  players: any[];
  showPlayers: boolean;
  setShowPlayers: (show: boolean) => void;
  myColor: string;
  nickname: string;
  myNumericId: number;
  setGameState: (state: 'menu' | 'playing') => void;
  playerUI: PlayerUIData[];
  isAuthenticating: boolean;
  setIsAuthenticating: (v: boolean) => void;
  roomId: string;
}

export function ConnectionOverlay({
  isAuthenticating, setIsAuthenticating, roomId, connStatus, setGameState, networkClient
}: {
  isAuthenticating: boolean;
  setIsAuthenticating: (v: boolean) => void;
  roomId: string;
  connStatus: string;
  setGameState: (state: 'menu' | 'playing') => void;
  networkClient: any;
}) {
  if (!isAuthenticating) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center font-mono">
      <div className="w-64 h-1 bg-emerald-500/20 mb-8 overflow-hidden relative">
          <div className="absolute inset-y-0 bg-emerald-500 animate-[loading_2s_infinite]" style={{ width: '30%' }} />
      </div>
      <div className="text-emerald-500 text-[10px] tracking-[0.3em] uppercase mb-2 animate-pulse">Establishing Connection</div>
      <div className="text-emerald-500/40 text-[8px] tracking-[0.1em] uppercase mb-8">Frequency: {roomId}</div>
      <div className="flex flex-col gap-1 items-center">
          <div className="text-emerald-500/20 text-[7px] uppercase">Syncing Buffer... OK</div>
          <div className="text-emerald-500/20 text-[7px] uppercase">Allocating Neural Space... OK</div>
          <div className="text-emerald-500/60 text-[7px] uppercase animate-pulse">
              {connStatus === 'connected' ? 'Awaiting Protocol Handshake...' : 
              connStatus === 'connecting' ? 'Synchronizing Frequencies...' : 'Establishing Connection...'}
          </div>
      </div>
      
      <button 
          onClick={() => {
              setIsAuthenticating(false);
              setGameState('menu');
              networkClient.disconnect();
          }}
          className="mt-12 px-6 py-2 border border-emerald-500/20 text-emerald-500/40 text-[9px] uppercase tracking-widest hover:bg-emerald-500/10 transition-all pointer-events-auto"
      >
          Abort
      </button>
    </div>
  );
}

export function DepthIndicatorOverlay({ gameState, playerY }: { gameState: string; playerY: number }) {
  const depthPercent = Math.min(100, (Math.abs(playerY) / 500) * 100);
  return (
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
          style={{ top: `${depthPercent}%` }}
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
  );
}

export function NetworkStatsOverlay({
  connStatus,
  gameState,
  players,
  showPlayers,
  setShowPlayers,
  myColor,
  nickname,
  myNumericId,
  setGameState
}: {
  connStatus: string;
  gameState: string;
  players: any[];
  showPlayers: boolean;
  setShowPlayers: (show: boolean) => void;
  myColor: string;
  nickname: string;
  myNumericId: number;
  setGameState: (state: 'menu' | 'playing') => void;
}) {
  return (
      <div className="absolute top-6 right-6 flex flex-col items-end pointer-events-none font-mono text-[10px] tracking-widest uppercase gap-4 z-[60]">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${connStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : connStatus === 'connecting' ? 'bg-amber-400 animate-spin' : 'bg-red-500'}`} />
            <div id="ui-ping" className={`${connStatus === 'connected' ? 'text-emerald-400' : 'text-white/40'}`}>
              {connStatus === 'connected' ? `PING: -- MS` : connStatus === 'connecting' ? 'CONNECTING...' : 'DISCONNECTED'}
            </div>
          </div>
          <div id="ui-fps" className="text-emerald-400/40">FPS: --</div>
          <div id="ui-chunks" className="text-emerald-500 animate-pulse transition-opacity duration-300" style={{opacity: 0}}>GENERATING...</div>
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
                      <span className="font-bold tracking-tighter" style={{ color: myColor }}>{nickname || 'Prospector'}</span>
                      <div className="w-1 h-3 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: myColor, color: myColor }} />
                   </div>
                )}

                {players.map(p => (
                  <div key={p.numericId} className="flex items-center gap-2 px-2 py-0.5 w-full justify-end group transition-all hover:bg-emerald-500/5">
                    {p.numericId === myNumericId && <span className="text-white/20 text-[7px]">(YOU)</span>}
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
             }}
             className="px-4 py-2 bg-red-500/20 border border-red-500 text-red-500 text-[10px] pointer-events-auto hover:bg-red-500/40 transition-all rounded"
           >
             RETURN TO TERMINAL
           </button>
        )}
      </div>
  );
}

export function PlayerOverlays({ gameState, playerUI }: { gameState: string; playerUI: PlayerUIData[] }) {
  if (gameState !== 'playing') return null;

  return (
    <>
      {playerUI.map(p => {
        if (!p.visible) return null;
        if (p.offScreen) {
          const arrowX = Math.max(5, Math.min(95, p.screenX < 0 ? 5 : (p.screenX > 100 ? 95 : p.screenX)));
          const arrowY = Math.max(5, Math.min(95, p.screenY < 0 ? 5 : (p.screenY > 100 ? 95 : p.screenY)));
          
          return (
            <div 
              key={`arrow-${p.nid}`}
              className="fixed z-[55] pointer-events-none transition-all duration-75"
              style={{ left: `${arrowX}%`, top: `${arrowY}%`, transform: `translate(-50%, -50%) rotate(${p.angle}rad)` }}
            >
              <div 
                className="w-0 h-0 border-l-[8px] border-r-[8px] border-b-[14px] border-l-transparent border-r-transparent animate-pulse filter drop-shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                style={{ borderBottomColor: p.color }}
              />
            </div>
          );
        } else {
          const opacity = Math.max(0.2, 1.0 - p.dist / 50);
          if (opacity <= 0.2) return null;
          
          return (
            <div 
              key={`tag-${p.nid}`}
              className="fixed z-[55] pointer-events-none -translate-x-1/2 -translate-y-[120%] flex flex-col items-center"
              style={{ left: `${p.screenX}%`, top: `${p.screenY}%`, opacity }}
            >
              <div className="px-2 py-0.5 bg-black/60 border-t border-white/10 backdrop-blur-[2px] rounded text-[10px] font-mono tracking-wider whitespace-nowrap shadow-xl" style={{ color: p.color }}>
                {p.nickname}
              </div>
              <div className="w-1 h-1 bg-white/20 rotate-45 -mt-0.5" />
            </div>
          );
        }
      })}
    </>
  );
}

export function HUDOverlay({
  ctx, gameState, nearSign, nearLift, liftTarget, playerY,
  connStatus, players, showPlayers, setShowPlayers, myColor, nickname, myNumericId, setGameState,
  playerUI, isAuthenticating, setIsAuthenticating, roomId
}: HUDOverlayProps) {
  
  if (isAuthenticating) {
    return (
      <ConnectionOverlay 
        isAuthenticating={isAuthenticating}
        setIsAuthenticating={setIsAuthenticating}
        roomId={roomId}
        connStatus={connStatus}
        setGameState={setGameState}
        networkClient={ctx.network}
      />
    );
  }

  if (gameState !== 'playing') return null;

  return (
    <>
      <PlayerOverlays gameState={gameState} playerUI={playerUI} />
      <DepthIndicatorOverlay gameState={gameState} playerY={playerY} />
      <NetworkStatsOverlay 
        connStatus={connStatus} 
        gameState={gameState} 
        players={players} 
        showPlayers={showPlayers} 
        setShowPlayers={setShowPlayers} 
        myColor={myColor} 
        nickname={nickname} 
        myNumericId={myNumericId} 
        setGameState={setGameState} 
      />

      {/* Target Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50 pointer-events-none mix-blend-difference z-40">
         <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
      </div>

      {nearSign && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/60 backdrop-blur-sm border border-emerald-500/30 p-4 max-w-xs text-center animate-in fade-in slide-in-from-top-4 duration-500 z-50">
          <p className="text-emerald-400 font-mono text-sm leading-relaxed uppercase tracking-widest italic">
            "Если готов погрузится в бездну - будь готов и к ее испытаниям!"
          </p>
        </div>
      )}

      {/* Adaptive HUD */}
      <div className="absolute inset-x-0 bottom-0 top-0 pointer-events-none p-4 sm:p-8 z-40 grid grid-cols-[1fr_auto] grid-rows-[1fr_auto] items-end block-touch-actions">
        {/* Virtual Joystick area (Bottom Left) */}
        <div id="joystick-base" className="w-24 h-24 rounded-full border border-white/30 bg-white/10 sm:hidden fixed pointer-events-none opacity-0 transition-opacity duration-200 z-50">
          <div className="absolute inset-0 flex items-center justify-center">
             <div id="joystick-thumb" className="w-10 h-10 rounded-full bg-emerald-500/50 border border-emerald-500/80 transition-transform duration-75"></div>
          </div>
        </div>

        {/* Action Buttons (Bottom Right) */}
        <div className="col-start-2 row-start-2 justify-self-end pointer-events-auto transition-opacity mb-4 mr-4 sm:mb-8 sm:mr-8 relative w-32 h-32 sm:hidden">
             
             {/* Dig Button (Center) */}
             <button 
               onPointerDown={(e) => { e.preventDefault(); nearLift ? (window as any)._triggerInteract?.() : (window as any)._triggerAction?.(); }}
               className={`absolute top-1/2 left-0 -translate-y-1/2 w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center text-white active:scale-95 transition-transform shadow-lg z-10 ${nearLift ? 'bg-amber-600/80 border-amber-400 text-amber-50 shadow-[0_0_20px_rgba(217,119,6,0.5)]' : 'bg-emerald-600/80 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.5)]'} font-mono`}>
               {nearLift ? <Zap size={24} /> : <Pickaxe size={24} />}
               <span className="text-[10px] font-bold uppercase mt-1 text-center leading-tight">
                 {nearLift ? (liftTarget === 0 ? 'DOWN' : 'UP') : 'DIG'}
               </span>
             </button>

             {/* Flashlight Button (Top Right) */}
             <button 
               onPointerDown={(e) => { e.preventDefault(); (window as any)._triggerLight?.(); }}
               className="absolute top-0 right-0 w-12 h-12 rounded-full bg-slate-900/80 backdrop-blur-md border border-emerald-500/30 flex flex-col items-center justify-center text-slate-300 active:scale-95 transition-transform hover:bg-slate-800/60 font-mono shadow-[0_0_20px_rgba(0,0,0,0.5)] z-0">
               <Flashlight size={18} />
               <span className="text-[8px] uppercase mt-0.5">Light</span>
             </button>

             {/* Jump Button (Bottom Right) */}
             <button 
               onPointerDown={(e) => { e.preventDefault(); (window as any)._triggerJump?.(); }}
               className="absolute bottom-0 right-0 w-12 h-12 rounded-full bg-slate-900/80 backdrop-blur-md border border-emerald-500/30 flex flex-col items-center justify-center text-slate-300 active:scale-95 transition-transform hover:bg-slate-800/60 font-mono shadow-[0_0_20px_rgba(0,0,0,0.5)] z-0 sm:hidden">
               <span className="text-lg leading-none font-bold">⬆</span>
               <span className="text-[8px] uppercase mt-0.5">Jump</span>
             </button>

        </div>
      </div>
    </>
  );
}
