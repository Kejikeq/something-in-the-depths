import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import fs from "fs";

const ZONE_SIZE = 50;

interface Player {
  id: string;
  numericId: number;
  nickname: string;
  color: string;
  x: number;
  y: number;
  z: number;
  zoneY: number;
}

const PLAYER_COLORS = [
  "#34d399", // Emerald
  "#60a5fa", // Blue
  "#f472b6", // Pink
  "#fbbf24", // Amber
  "#a78bfa", // Violet
  "#22d3ee", // Cyan
  "#f87171", // Red
  "#fb923c", // Orange
];

class Room {
  public id: string;
  public holes: any[] = new Array(2048).fill(null);
  public holeCount = 0;
  public players = new Map<string, Player>();
  public lastActivity = Date.now();
  private nextNumericId = 1;

  constructor(id: string) {
    this.id = id;
  }

  getZone(y: number) {
    return Math.floor(y / ZONE_SIZE);
  }

  addPlayer(id: string, pos: { x: number; y: number; z: number }, nickname: string = "Prospector") {
    const existing = this.players.get(id);
    const zoneY = this.getZone(pos.y);
    
    if (existing) {
      const oldZone = existing.zoneY;
      existing.x = pos.x;
      existing.y = pos.y;
      existing.z = pos.z;
      existing.zoneY = zoneY;
      if (nickname !== "Prospector") existing.nickname = nickname;
      
      return { player: existing, zoneChanged: oldZone !== zoneY };
    } else {
      const color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
      const newPlayer = { ...pos, id, numericId: this.nextNumericId++, zoneY, nickname, color };
      this.players.set(id, newPlayer);
      this.lastActivity = Date.now();
      return { player: newPlayer, zoneChanged: true };
    }
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  addHole(hole: any) {
    const index = this.holeCount % 2048;
    this.holes[index] = hole;
    this.holeCount++;
    this.lastActivity = Date.now();
    return this.holeCount > 2048; // Indicated we started overwriting
  }

  isEmpty() {
    return this.players.size === 0;
  }

  getValidHoles() {
    return this.holes.filter(h => h !== null);
  }

  // Get holes relevant to a specific zone (current + neighbors)
  getFilteredHoles(zoneY: number) {
    return this.holes.filter(h => {
      if (!h) return false;
      const hZone = this.getZone(h.y);
      return Math.abs(hZone - zoneY) <= 1;
    });
  }
}

class GameServer {
  private rooms = new Map<string, Room>();
  private wss: WebSocketServer;

  constructor(server: any, app: any) {
    this.wss = new WebSocketServer({ noServer: true });
    
    app.get("/api/stats", (_req: any, res: any) => {
      const stats = {
        totalPlayers: 0,
        rooms: [] as any[]
      };
      this.rooms.forEach((room, id) => {
        const count = room.players.size;
        stats.totalPlayers += count;
        stats.rooms.push({ id, players: count });
      });
      res.json(stats);
    });

    app.get("/api/wasm-version", (_req: any, res: any) => {
      const wasmPath = path.join(process.cwd(), "public", "game_core.wasm");
      try {
        if (fs.existsSync(wasmPath)) {
          const stats = fs.statSync(wasmPath);
          res.json({ version: stats.mtimeMs });
        } else {
          res.json({ version: 0 });
        }
      } catch (e) {
        res.status(500).json({ error: "Failed to check WASM status" });
      }
    });
    
    this.wss.on("error", (err) => {
      console.error("WSS error:", err);
    });

    server.on("upgrade", (request: any, socket: any, head: any) => {
      const url = request.url || "";
      const pathname = url.split("?")[0];
      
      console.log(`Upgrade request for: ${pathname}`);
      
      if (pathname === "/socket") {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      } else {
        // If it's not our socket path, we should let it pass or destroy it
        // Vite handles its own hmr on different paths if needed, but here we only care about /socket
        // Actually, don't destroy, just ignore if not matched
      }
    });

    this.init();
    
    // Heartbeat to clean up dead connections
    setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  private init() {
    this.wss.on("connection", (ws: WebSocket, req: any) => {
      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });
      ws.on('error', (err) => console.error(`Socket error:`, err));

      const playerId = Math.random().toString(36).substring(2, 9);
      const remoteIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      console.log(`[WS] New connection ${playerId} from ${remoteIp}`);
      
      (ws as any).playerId = playerId;
      let currentRoomId: string | null = null;

      // Protocol handshake: Send welcome to verify connection is ready for messages
      ws.send(JSON.stringify({ type: "welcome", id: playerId }));

      ws.on("message", (data: any, isBinary: boolean) => {
        try {
          if (isBinary) {
             const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
             this.handleBinaryMessage(ws, playerId, buffer);
             return;
          }
          
          const messageStr = Buffer.isBuffer(data) ? data.toString() : String(data);
          const msg = JSON.parse(messageStr);
          if (msg.type !== "ping") {
            console.log(`[WS] Received from ${playerId}:`, msg.type, msg.roomId || "");
          }
          this.handleMessage(ws, playerId, msg, (newId) => currentRoomId = newId);
        } catch (e) {
          console.error(`WS Message Error (Player ${playerId}):`, e);
        }
      });

      ws.on("close", () => {
        if (currentRoomId) this.handleDisconnect(playerId, currentRoomId);
      });
    });
  }

  private handleBinaryMessage(ws: WebSocket, playerId: string, data: Buffer) {
    const roomId = (ws as any).roomId;
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Format: [Type: 1 byte (104 for 'move'), x: float32, y: float32, z: float32]
    const type = data.readUInt8(0);
    if (type === 104) {
      const x = data.readFloatLE(1);
      const y = data.readFloatLE(5);
      const z = data.readFloatLE(9);
      const { player, zoneChanged } = room.addPlayer(playerId, { x, y, z });
      
      if (zoneChanged) {
        // Send a fresh list of holes for the new zone
        ws.send(JSON.stringify({
          type: "sync_holes",
          holes: room.getFilteredHoles(player.zoneY),
          holeCount: room.holeCount
        }));
      }

      // We still use JSON for the broadcast for now to keep ID associations easy
      this.broadcastToRoom(roomId, {
        type: "update_players",
        players: Array.from(room.players.values())
      });
    } else if (type === 106) {
      const hx = data.readFloatLE(1);
      const hy = data.readFloatLE(5);
      const hz = data.readFloatLE(9);
      const hr = data.readFloatLE(13);
      const hole = { x: hx, y: hy, z: hz, r: hr };
      
      const removed = room.addHole(hole);
      const holeZone = room.getZone(hy);

      if (removed) {
          this.broadcastToRoom(roomId, { type: "sync_holes", holes: room.getValidHoles(), holeCount: room.holeCount });
      } else {
          this.broadcastToRoom(roomId, { type: "new_hole", hole: hole }, holeZone);
      }
    }
  }

  private handleMessage(ws: WebSocket, playerId: string, msg: any, setRoom: (id: string) => void) {
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "join") {
      const roomId = msg.roomId || "global";
      const nickname = msg.nickname || "Prospector";
      const createIfMissing = msg.createIfMissing !== false;

      console.log(`[WS] Player ${playerId} attempting to join room: ${roomId} (createIfMissing: ${createIfMissing})`);

      if (!this.rooms.has(roomId) && !createIfMissing && roomId !== "global") {
        ws.send(JSON.stringify({ 
          type: "error", 
          code: "ROOM_NOT_FOUND",
          message: `Frequency ${roomId} is not currently broadcasting.` 
        }));
        return;
      }

      setRoom(roomId);
      (ws as any).roomId = roomId;

      if (!this.rooms.has(roomId)) {
        this.rooms.set(roomId, new Room(roomId));
      }

      const room = this.rooms.get(roomId)!;
      const { player } = room.addPlayer(playerId, { x: 0, y: 1.5, z: 66 }, nickname);

      const playerList = Array.from(room.players.values()).map(p => ({
        numericId: p.numericId,
        nickname: p.nickname,
        color: p.color
      }));

      ws.send(JSON.stringify({ 
        type: "init", 
        id: playerId, 
        numericId: player.numericId,
        color: player.color,
        holes: room.getFilteredHoles(player.zoneY),
        holeCount: room.holeCount,
        players: playerList
      }));

      // Broadcast metadata update to others
      this.broadcastToRoom(roomId, {
        type: "player_metadata",
        players: playerList
      });

      console.log(`Player ${playerId} joined room ${roomId}`);
      return; // Stop processing further for join message
    }

    const roomId = (ws as any).roomId;
    if (!roomId) return;

    if (msg.type === "move") {
        // Fallback for non-binary moves
      const room = this.rooms.get(roomId);
      if (room) {
        room.addPlayer(playerId, msg.pos);
        this.broadcastToRoom(roomId, {
          type: "update_players",
          players: Array.from(room.players.values())
        });
      }
    }

    if (msg.type === "dig") {
      const room = this.rooms.get(roomId);
      if (room) {
        const removed = room.addHole(msg.hole);
        const holeZone = room.getZone(msg.hole.y);

        if (removed) {
            // If the buffer was completely overwritten, we might need to sync everyone
            // but for Interest Management, we still prefer targeted syncs or filtered global sync
            this.broadcastToRoom(roomId, { type: "sync_holes", holes: room.getValidHoles(), holeCount: room.holeCount });
        } else {
            // Targeted broadcast: only players in the same zone or neighbor zones get the 'new_hole'
            this.broadcastToRoom(roomId, {
              type: "new_hole",
              hole: msg.hole
            }, holeZone);
        }
      }
    }
  }

  private handleDisconnect(playerId: string, roomId: string) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.removePlayer(playerId);
      console.log(`Player ${playerId} left room ${roomId}`);
      
      const playerList = Array.from(room.players.values()).map(p => ({
        numericId: p.numericId,
        nickname: p.nickname,
        color: p.color
      }));

      // Notify others of the departure
      this.broadcastToRoom(roomId, {
        type: "player_metadata",
        players: playerList
      });

      if (room.isEmpty()) {
        console.log(`Room ${roomId} empty, cleaning up...`);
        this.rooms.delete(roomId);
      }
    }
  }

  private broadcastToRoom(roomId: string, payload: any, originZoneY?: number) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    let data: string | Buffer;
    if (payload.type === "update_players") {
      const players = Array.from(room.players.values());
      const buffer = Buffer.alloc(2 + players.length * 16);
      buffer.writeUInt8(105, 0);
      buffer.writeUInt8(players.length, 1);
      
      players.forEach((p, i) => {
        const offset = 2 + i * 16;
        buffer.writeUInt32LE(p.numericId, offset);
        buffer.writeFloatLE(p.x, offset + 4);
        buffer.writeFloatLE(p.y, offset + 8);
        buffer.writeFloatLE(p.z, offset + 12);
      });
      data = buffer;
    } else {
      data = JSON.stringify(payload);
    }

    this.wss.clients.forEach(client => {
      const ws = client as any;
      if (ws.roomId === roomId && client.readyState === WebSocket.OPEN) {
        // Interest Management filtering
        if (originZoneY !== undefined) {
          const player = room.players.get(ws.playerId || "");
          if (player) {
            const dist = Math.abs(player.zoneY - originZoneY);
            if (dist > 1) return; // Skip if too far
          }
        }
        client.send(data);
      }
    });
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const PORT = 3000;

  new GameServer(server, app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
