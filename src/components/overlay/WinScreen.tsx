import React from 'react';
import { Zap } from 'lucide-react';

interface WinScreenProps {
  hasWon: boolean;
  onContinue: () => void;
}

export function WinScreen({ hasWon, onContinue }: WinScreenProps) {
  if (!hasWon) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-10 text-center animate-in fade-in zoom-in duration-1000">
      <Zap className="w-24 h-24 text-cyan-400 mb-6 animate-bounce" />
      <h2 className="text-emerald-400 font-mono text-6xl tracking-[0.2em] mb-4 drop-shadow-[0_0_30px_rgba(52,211,153,0.5)]">TREASURE CLAIMED</h2>
      <p className="text-emerald-600/80 font-mono text-lg max-w-lg mb-12 leading-relaxed tracking-wider uppercase">
        You reached the absolute bottom of the 500-unit abyss and secured the mystical crystal chest. 
        The expedition is a legendary success.
      </p>
      <button 
        onClick={onContinue}
        className="px-12 py-5 border-2 border-emerald-500/40 text-emerald-400 font-mono text-xl hover:bg-emerald-500/20 active:scale-95 transition-all uppercase tracking-[0.4em] shadow-[0_0_50px_rgba(16,185,129,0.2)]"
      >
        Continue
      </button>
    </div>
  );
}
