import React, { useState, useEffect, useRef } from 'react';
import { EngineContext } from '../../core/EngineContext';
import { vec3 } from '../../core/VoxelEngine';
import { CornerDownLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatOverlayProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  ctx: EngineContext;
  nickname: string;
  setNickname: (nick: string) => void;
}

interface ChatMessage {
  id: number;
  text: string;
  type: 'system' | 'user' | 'error';
  timestamp: number;
  timeStr?: string;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ isOpen, setIsOpen, ctx, nickname, setNickname }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageCounter = useRef(0);
  const initialized = useRef(false);

  // Initial welcome message
  useEffect(() => {
    if (!initialized.current) {
      addMessage('Welcome to Prospector! Type /help for commands.', 'system');
      initialized.current = true;
    }
  }, []);

  // Subscribe to network messages
  useEffect(() => {
    return ctx.subscribeToChat((data) => {
      // Avoid duplicate local messages if the server broadcasts back
      // Actually, usually it's better to just let the server handle all messages
      // but for local feedback we add it immediately.
      // If we add it locally, we should check if the sender is not us.
      if (data.sender !== nickname) {
        addMessage(`[${data.sender}] ${data.text}`, 'user');
      }
    });
  }, [ctx, nickname]);

  // Update 'now' to handle message fade-outs
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const addMessage = (text: string, type: 'system' | 'user' | 'error' = 'system') => {
    const d = new Date();
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    
    const newMessage: ChatMessage = {
      id: messageCounter.current++,
      text,
      type,
      timestamp: Date.now(),
      timeStr
    };
    setMessages(prev => [...prev.slice(-49), newMessage]);
  };

  const handleCommand = (cmd: string) => {
    const time = performance.now();
    const cycleDuration = 1440000; // Match useGameLoop

    if (cmd === '/day') {
      const baseTime = (8.0 + (time / cycleDuration) * 24.0);
      ctx.gameTimeOffset = 12.0 - (baseTime % 24.0);
      addMessage('Time set to Day', 'system');
    } else if (cmd === '/night') {
      const baseTime = (8.0 + (time / cycleDuration) * 24.0);
      ctx.gameTimeOffset = 0.0 - (baseTime % 24.0);
      addMessage('Time set to Night', 'system');
    } else if (cmd === '/update') {
      if (ctx.chunkRenderer) {
        ctx.chunkRenderer.dirtyAll();
        addMessage('Chunks force updated', 'system');
      } else {
        addMessage('Chunk renderer not found', 'error');
      }
    } else if (cmd === '/spawn') {
      ctx.player.pos = new vec3(40, 10, 40);
      ctx.player.vel = new vec3(0, 0, 0);
      addMessage('Respawned to surface', 'system');
    } else if (cmd.startsWith('/rain')) {
      const parts = cmd.split(' ');
      if (parts.length === 1) {
        ctx.weather.toggleRain(!ctx.weather.isItRaining());
        addMessage(`Rain toggled: ${ctx.weather.isItRaining() ? 'ON' : 'OFF'}`, 'system');
      } else if (parts[1] === 'on') {
        ctx.weather.toggleRain(true);
        addMessage('Rain turned ON', 'system');
      } else if (parts[1] === 'off') {
        ctx.weather.toggleRain(false);
        addMessage('Rain turned OFF', 'system');
      }
    } else if (cmd.startsWith('/nick ')) {
      const newNick = cmd.split(' ').slice(1).join(' ').trim();
      if (newNick && newNick.length <= 16) {
        setNickname(newNick.toUpperCase());
        addMessage(`Username changed to: ${newNick.toUpperCase()}`, 'system');
      } else {
        addMessage('Nickname must be 1-16 characters', 'error');
      }
    } else if (cmd === '/help') {
      addMessage('Commands: /day, /night, /rain [on/off], /update, /spawn, /nick [name]', 'system');
    } else if (cmd.startsWith('/')) {
      addMessage(`Unknown command: ${cmd}`, 'error');
    } else {
      addMessage(`[${nickname || 'Player'}] ${cmd}`, 'user');
      ctx.network.sendChatMessage(cmd, nickname || 'Player'); 
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setIsOpen(false);
      return;
    }
    handleCommand(input.trim());
    setInput('');
    setIsOpen(false);
  };

  const visibleMessages = isOpen 
    ? messages 
    : messages.filter(m => now - m.timestamp < 7000);

  return (
    <div className="absolute bottom-32 left-8 z-[70] w-[400px] font-mono pointer-events-none flex flex-col">
      {/* Message Area */}
      <div 
        ref={scrollRef}
        className={`flex flex-col gap-0.5 mb-2 transition-all duration-300 ${
          isOpen 
            ? 'bg-black/80 backdrop-blur-md border border-white/10 rounded-lg p-3 max-h-[300px] overflow-y-auto pointer-events-auto shadow-2xl' 
            : 'max-h-[240px]'
        }`}
      >
        <AnimatePresence initial={false}>
          {visibleMessages.map((msg) => (
            <motion.div
              layout
              key={msg.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              className={`text-xs px-2 py-0.5 flex items-start gap-2 ${
                !isOpen ? 'bg-black/40 rounded border-l-2 mb-0.5 shadow-sm' : 'hover:bg-white/5 transition-colors rounded'
              } ${
                msg.type === 'system' ? 'border-emerald-500 text-emerald-400 font-bold' :
                msg.type === 'error' ? 'border-red-500 text-red-400' :
                'border-white/20 text-white'
              }`}
            >
              <span className="opacity-30 shrink-0 select-none">[{msg.timeStr}]</span>
              <span className="break-words flex-1">{msg.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onSubmit={handleSubmit}
            className="pointer-events-auto flex gap-2 items-center bg-black/80 border border-emerald-500/30 p-2 rounded-lg backdrop-blur-md shadow-2xl"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type /help for commands..."
              className="bg-transparent border-none outline-none text-emerald-400 text-sm flex-1 placeholder:text-emerald-900 ml-2"
            />
            <button type="submit" className="text-emerald-500/50 hover:text-emerald-500 transition-colors px-2">
              <CornerDownLeft size={16} />
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};
