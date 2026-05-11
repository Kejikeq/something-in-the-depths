import React from 'react';
import { Pickaxe, Zap, Flashlight } from 'lucide-react';

interface HUDOverlayProps {
  gameState: 'menu' | 'playing';
  nearSign: boolean;
  nearLift: boolean;
  liftTarget: number;
}

export function HUDOverlay({ gameState, nearSign, nearLift, liftTarget }: HUDOverlayProps) {
  if (gameState !== 'playing') return null;

  return (
    <>
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
