import React from 'react';

interface ConnectionOverlayProps {
  isAuthenticating: boolean;
  setIsAuthenticating: (v: boolean) => void;
  roomId: string;
  connStatus: 'disconnected' | 'connecting' | 'connected';
  setGameState: (state: 'menu' | 'playing') => void;
  networkClient: any;
}

export function ConnectionOverlay({
  isAuthenticating, setIsAuthenticating, roomId, connStatus, setGameState, networkClient
}: ConnectionOverlayProps) {
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
              networkClient.current.disconnect();
          }}
          className="mt-12 px-6 py-2 border border-emerald-500/20 text-emerald-500/40 text-[9px] uppercase tracking-widest hover:bg-emerald-500/10 transition-all pointer-events-auto"
      >
          Abort
      </button>
    </div>
  );
}
