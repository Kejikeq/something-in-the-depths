/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GameMessage = 
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error', code: string, message: string }
  | { type: 'join', roomId: string, nickname: string, createIfMissing?: boolean }
  | { type: 'init', id: string, numericId: number, color: string, voxels?: Record<string, string>, holes?: {x: number, y: number, z: number, r: number}[], players?: any[] }
  | { type: 'player_metadata', players: any[] }
  | { type: 'move', pos: { x: number, y: number, z: number } }
  | { type: 'update_players', players: any[] }
  | { type: 'player_moved', playerId: string, pos: { x: number, y: number, z: number } }
  | { type: 'dig', hole: { x: number, y: number, z: number, r: number } }
  | { type: 'new_hole', hole: { x: number, y: number, z: number, r: number } }
  | { type: 'update_voxels', voxels: Record<string, string> }
  | { type: 'sync_voxels', voxels?: Record<string, string>, holes?: {x: number, y: number, z: number, r: number}[] }
  | { type: 'chat', text: string, sender: string, timestamp: number };

export interface NetworkCallbacks {
  onInit?: (data: { id: string; numericId: number; color: string; voxels?: Record<string, string>; holes?: {x: number, y: number, z: number, r: number}[], players?: any[] }) => void;
  onPlayerMetadata?: (players: any[]) => void;
  onUpdatePlayers?: (players: any[]) => void;
  onPlayerMoved?: (playerId: string, pos: { x: number, y: number, z: number }) => void;
  onBinaryUpdate?: (buffer: ArrayBuffer) => void;
  onNewHole?: (hole: { x: number; y: number; z: number; r: number }) => void;
  onUpdateVoxels?: (voxels: Record<string, string>) => void;
  onSyncVoxels?: (voxels?: Record<string, string>, holes?: {x: number, y: number, z: number, r: number}[]) => void;
  onChatMessage?: (data: { text: string; sender: string; timestamp: number }) => void;
  onPing?: (ping: number) => void;
  onClose?: () => void;
  onError?: (err: any) => void;
  onServerError?: (error: { code: string, message: string }) => void;
}

export class NetworkClient {
  private socket: WebSocket | null = null;
  public playerId: string = "";
  public ping: number = 0;
  private lastPingTime: number = 0;
  private pingInterval: any = null;
  private syncInterval: any = null;
  private callbacks: NetworkCallbacks = {};
  private initReceived: boolean = false;
  private joinAttempts: number = 0;
  private connectionTimer: any = null;
  private joinRetryTimer: any = null;
  private wasmCore: any = null;
  private wasmModule: any = null;

  constructor() {}

  public setWasmCore(core: any, module: any) {
    this.wasmCore = core;
    this.wasmModule = module;
  }

  public setCallbacks(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
  }

  private lastBroadcastTime: number = 0;

  public connect(roomId: string, nickname: string, createIfMissing: boolean = true) {
    if (this.socket) {
        if (this.socket.readyState === WebSocket.OPEN && this.initReceived) {
            console.log("Network: Already connected, re-triggering init callback");
            this.callbacks.onInit?.({ 
                id: this.playerId, 
                numericId: 0, 
                color: "#ffffff",
                voxels: {},
                players: [] 
            });
            return;
        }
        console.log("Network: Closing existing socket before reconnecting");
        this.disconnect();
    }
    
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      this.socket = new WebSocket(`${protocol}//${host}/socket`);
      
      this.socket.binaryType = "arraybuffer";
      
      this.socket.onopen = () => {
        console.log("Network: WebSocket connection opened, sending join request...");
        this.initReceived = false;
        this.joinAttempts = 0;
        this.startPingLoop();
        this.startSyncLoop();
        
        // C11 server HTTP upgrade completed, we are in Active Binary / WS Active state.
        // Send join (meta-action) immediately.
        this.attemptJoin(roomId, nickname, createIfMissing);
        
        // Safety timeout for the whole connection process
        this.connectionTimer = setTimeout(() => {
          if (!this.initReceived) {
             console.error("Network: Handshake failed - No init response within 15s");
             this.disconnect();
             this.callbacks.onServerError?.({ code: "TIMEOUT", message: "Frequency locked. Handshake failed." });
          }
        }, 15000);
      };

      this.socket.onmessage = (event) => {
        try {
          if (event.data instanceof ArrayBuffer) {
            const view = new DataView(event.data);
            const type = view.getUint8(0);
            
            if (type === 104 && this.wasmCore && event.data.byteLength === 13) {
              // 104 (Other Player Move - as per request)
              const x = view.getFloat32(1, true);
              const y = view.getFloat32(5, true);
              const z = view.getFloat32(9, true);
              this.wasmCore.setPosition(x, y, z, 0);
              return;
            } else if (type === 106 && event.data.byteLength === 17) {
              // 106 (New Hole)
              const x = view.getFloat32(1, true);
              const y = view.getFloat32(5, true);
              const z = view.getFloat32(9, true);
              const r = view.getFloat32(13, true);
              this.callbacks.onNewHole?.({ x, y, z, r });
              return;
            } else if (type === 105) {
              // 105 (Other Players Arrays)
              this.callbacks.onBinaryUpdate?.(event.data);
              return;
            }
            return;
          }

          const msg = JSON.parse(event.data) as GameMessage;

          if (msg.type === "pong") {
            this.ping = Math.max(1, Date.now() - this.lastPingTime);
            this.callbacks.onPing?.(this.ping);
            return;
          }
          if (msg.type === "error") {
            this.callbacks.onServerError?.({ code: (msg as any).code, message: (msg as any).message });
            return;
          }
          if (msg.type === "init") {
            this.initReceived = true;
            this.clearConnectionTimers();
            this.playerId = msg.id;
            this.callbacks.onInit?.(msg);
          } else if (msg.type === "player_metadata") {
            this.callbacks.onPlayerMetadata?.(msg.players);
          } else if (msg.type === "update_players") {
            this.callbacks.onUpdatePlayers?.(msg.players);
          } else if (msg.type === "player_moved") {
            this.callbacks.onPlayerMoved?.(msg.playerId, msg.pos);
          } else if (msg.type === "new_hole") {
            this.callbacks.onNewHole?.(msg.hole);
          } else if (msg.type === "update_voxels") {
            this.callbacks.onUpdateVoxels?.(msg.voxels);
          } else if (msg.type === "sync_voxels") {
            this.callbacks.onSyncVoxels?.(msg.voxels, msg.holes);
          } else if (msg.type === "chat") {
            this.callbacks.onChatMessage?.(msg);
          }
        } catch (e) {
          console.warn("Network: failed to parse message", e);
        }
      };

      this.socket.onerror = (err) => {
        console.error("Network: WebSocket error", err);
        this.callbacks.onError?.(err);
      };

      this.socket.onclose = (event) => {
        console.log("Network: Connection closed", event.code, event.reason);
        this.stopPingLoop();
        this.stopSyncLoop();
        this.socket = null;
        this.callbacks.onClose?.();
      };
    } catch (e) {
      this.callbacks.onError?.(e);
      console.error("Network: connection failed", e);
    }
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 2000);
  }

  private stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private positionGetter: (() => {x: number, y: number, z: number}) | null = null;
  public setPositionGetter(fn: () => {x: number, y: number, z: number}) {
      this.positionGetter = fn;
  }

  private lastSentPos = { x: -999, y: -999, z: -999 };

  private startSyncLoop() {
    this.stopSyncLoop();
    this.syncInterval = setInterval(() => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.initReceived) {
            let state = null;
            if (this.wasmCore) {
                state = this.wasmCore.getPlayerState();
            } else if (this.positionGetter) {
                state = this.positionGetter();
            }
            if (state) {
                const dx = state.x - this.lastSentPos.x;
                const dy = state.y - this.lastSentPos.y;
                const dz = state.z - this.lastSentPos.z;
                if (dx*dx + dy*dy + dz*dz > 0.001) {
                    this.broadcastMove(state.x, state.y, state.z);
                    this.lastSentPos = { x: state.x, y: state.y, z: state.z };
                }
            }
        }
    }, 100); // 10 times per second
  }

  private stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private attemptJoin(roomId: string, nickname: string, createIfMissing: boolean) {
    if (this.initReceived || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    
    if (this.joinAttempts >= 10) {
      console.error("Network: Max join attempts reached");
      this.disconnect();
      this.callbacks.onServerError?.({ code: "MAX_ATTEMPTS", message: "Max join attempts reached. Frequency jammed." });
      return;
    }

    this.joinAttempts++;
    console.log(`Network: Attempting join (${this.joinAttempts}/10)`);
    this.send({ type: "join", roomId, nickname, createIfMissing });
    
    this.joinRetryTimer = setTimeout(() => {
      if (!this.initReceived) {
        this.attemptJoin(roomId, nickname, createIfMissing);
      }
    }, 1000);
  }

  private clearConnectionTimers() {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    if (this.joinRetryTimer) {
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
  }

  public isConnected() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN && this.initReceived;
  }

  public get isConnecting() {
    return this.socket !== null && this.socket.readyState === WebSocket.CONNECTING;
  }

  public broadcastPosition() {
    if (!this.wasmCore) return;
    const state = this.wasmCore.getPlayerState();
    if (state) {
        this.broadcastMove(state.x, state.y, state.z);
    }
  }

  public broadcastMove(x: number, y: number, z: number) {
    if (this.socket?.readyState === WebSocket.OPEN) {
        // Binary Format: [Type: 1 byte (104 for 'move'), x: float32, y: float32, z: float32]
        const buffer = new ArrayBuffer(13);
        const view = new DataView(buffer);
        view.setUint8(0, 104); 
        view.setFloat32(1, x, true);
        view.setFloat32(5, y, true);
        view.setFloat32(9, z, true);
        this.socket.send(buffer);
    }
  }

  public broadcastDig(x: number, y: number, z: number, r: number) {
    if (this.socket?.readyState === WebSocket.OPEN) {
        // Binary Format: [Type: 1 byte (106 for 'dig'), x: float32, y: float32, z: float32, r: float32]
        const buffer = new ArrayBuffer(17);
        const view = new DataView(buffer);
        view.setUint8(0, 106); 
        view.setFloat32(1, x, true);
        view.setFloat32(5, y, true);
        view.setFloat32(9, z, true);
        view.setFloat32(13, r, true);
        this.socket.send(buffer);
    }
  }

  public sendChatMessage(text: string, sender: string) {
    this.send({
      type: 'chat',
      text,
      sender,
      timestamp: Date.now()
    });
  }

  public send(msg: GameMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  public sendPing() {
    this.lastPingTime = Date.now();
    this.send({ type: "ping" });
  }

  public disconnect() {
    this.stopPingLoop();
    this.stopSyncLoop();
    this.clearConnectionTimers();
    this.initReceived = false;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
