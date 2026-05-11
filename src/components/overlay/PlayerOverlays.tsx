import React from 'react';

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

interface PlayerOverlaysProps {
  gameState: 'menu' | 'playing';
  playerUI: PlayerUIData[];
}

export function PlayerOverlays({ gameState, playerUI }: PlayerOverlaysProps) {
  if (gameState !== 'playing') return null;

  return (
    <>
      {playerUI.map(p => {
        if (!p.visible) return null;
        if (p.offScreen) {
          // Off-screen arrow
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
          // Name tag
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
