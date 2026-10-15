import { DurableObject } from "cloudflare:workers";

type Mark = "x" | "o";
type Cell = Mark | null;
type Role = Mark | "spectator";

interface Player {
  name: string;
  token: string;
  connected: boolean;
}

interface Room {
  created: true;
  code: string;
  x: Player | null;
  o: Player | null;
  board: Cell[];
  turn: Mark;
  winner: Mark | "draw" | null;
  winningLine: number[] | null;
  scores: { x: number; o: number };
  round: number;
  updatedAt: number;
}

interface Attachment {
  role: Role;
  token: string | null;
}

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

function emptyBoard(): Cell[] {
  return [null, null, null, null, null, null, null, null, null];
}

function initialRoom(code: string): Room {
  return {
    created: true,
    code,
    x: null,
    o: null,
    board: emptyBoard(),
    turn: "x",
    winner: null,
    winningLine: null,
    scores: { x: 0, o: 0 },
    round: 1,
    updatedAt: Date.now(),
  };
}

function phaseOf(room: Room): "waiting" | "playing" | "finished" {
  if (!room.x || !room.o) return "waiting";
  if (room.winner) return "finished";
  return "playing";
}

function cleanName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 18) return null;
  return name;
}

function cleanToken(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (!/^[A-Za-z0-9-]{16,80}$/.test(input)) return null;
  return input;
}

function publicPlayer(player: Player | null) {
  if (!player) return null;
  return { name: player.name, connected: player.connected };
}

export class GameRoom extends DurableObject {
  private room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>("room")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/create")) {
      if (this.room?.created) {
        return Response.json({ error: "exists" }, { status: 409 });
      }
      const body = (await request.json()) as { code?: string };
      const code = body.code ?? "";
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        return Response.json({ error: "code" }, { status: 400 });
      }
      this.room = initialRoom(code);
      await this.persist();
      return Response.json({ code });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.room?.created) {
        return new Response("Esta sala no existe", { status: 404 });
      }
      if (this.ctx.getWebSockets().length >= 12) {
        return new Response("Demasiadas conexiones en esta sala", { status: 429 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ role: "spectator", token: null } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (request.method === "GET") {
      if (!this.room?.created) {
        return Response.json({ exists: false }, { status: 404 });
      }
      return Response.json({
        exists: true,
        code: this.room.code,
        phase: phaseOf(this.room),
        players: {
          x: publicPlayer(this.room.x),
          o: publicPlayer(this.room.o),
        },
        scores: this.room.scores,
      });
    }

    return new Response("No encontrado", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.room?.created) {
      this.send(ws, { type: "error", message: "Esta sala no existe.", fatal: true });
      ws.close(1008, "Sala no existe");
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      this.send(ws, { type: "error", message: "Mensaje inválido." });
      return;
    }
    if (!data || typeof data !== "object") return;

    const msg = data as { type?: string; name?: unknown; token?: unknown; i?: unknown };
    if (msg.type === "join") {
      await this.join(ws, msg.name, msg.token);
      return;
    }
    if (msg.type === "move") {
      await this.move(ws, msg.i);
      return;
    }
    if (msg.type === "restart") {
      await this.restart(ws);
      return;
    }
    if (msg.type === "ping") {
      this.send(ws, { type: "pong" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (!this.room) return;
    const seat = attachment(ws);
    if (seat.role !== "x" && seat.role !== "o") return;

    const stillThere = this.ctx.getWebSockets().some((other) => {
      if (other === ws) return false;
      const otherSeat = attachment(other);
      return otherSeat.token !== null && otherSeat.token === seat.token;
    });
    const player = this.room[seat.role];
    if (player && player.token === seat.token && !stillThere) {
      player.connected = false;
      await this.persist();
      this.broadcast();
    }
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  private async join(ws: WebSocket, rawName: unknown, rawToken: unknown): Promise<void> {
    const room = this.room;
    if (!room) return;

    const token = cleanToken(rawToken);
    if (token && room.x?.token === token) {
      room.x.connected = true;
      this.seat(ws, "x", token);
      await this.persist();
      this.welcome(ws, "x", token);
      this.broadcast();
      return;
    }
    if (token && room.o?.token === token) {
      room.o.connected = true;
      this.seat(ws, "o", token);
      await this.persist();
      this.welcome(ws, "o", token);
      this.broadcast();
      return;
    }

    const name = cleanName(rawName);
    if (!name) {
      this.send(ws, {
        type: "error",
        message: "Escribe un nombre de 1 a 18 caracteres.",
        fatal: true,
      });
      return;
    }

    const newToken = crypto.randomUUID();
    if (!room.x) {
      room.x = { name, token: newToken, connected: true };
      this.seat(ws, "x", newToken);
      await this.persist();
      this.welcome(ws, "x", newToken);
      this.broadcast();
      return;
    }
    if (!room.o) {
      room.o = { name, token: newToken, connected: true };
      this.seat(ws, "o", newToken);
      await this.persist();
      this.welcome(ws, "o", newToken);
      this.broadcast();
      return;
    }

    this.seat(ws, "spectator", null);
    this.welcome(ws, "spectator", null);
    this.send(ws, {
      type: "error",
      message: "La sala ya tiene dos jugadores. Puedes mirar la partida.",
    });
    this.broadcast();
  }

  private async move(ws: WebSocket, rawIndex: unknown): Promise<void> {
    const room = this.room;
    if (!room) return;
    const seat = attachment(ws);
    if (seat.role !== "x" && seat.role !== "o") {
      this.send(ws, { type: "error", message: "Solo los jugadores pueden mover." });
      return;
    }
    if (phaseOf(room) !== "playing") {
      this.send(ws, { type: "error", message: "La partida no está en curso." });
      return;
    }
    if (seat.role !== room.turn) {
      this.send(ws, { type: "error", message: "Aún no es tu turno." });
      return;
    }
    const player = room[seat.role];
    if (!player || player.token !== seat.token) {
      this.send(ws, { type: "error", message: "No estás sentado en esta partida." });
      return;
    }
    if (typeof rawIndex !== "number" || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex > 8) {
      this.send(ws, { type: "error", message: "Casilla inválida." });
      return;
    }
    if (room.board[rawIndex]) {
      this.send(ws, { type: "error", message: "Esa casilla ya está ocupada." });
      return;
    }

    room.board[rawIndex] = seat.role;
    const outcome = judge(room.board);
    if (outcome?.winner === "x" || outcome?.winner === "o") {
      room.winner = outcome.winner;
      room.winningLine = outcome.line;
      room.scores[outcome.winner] += 1;
    } else if (outcome?.winner === "draw") {
      room.winner = "draw";
      room.winningLine = null;
    } else {
      room.turn = room.turn === "x" ? "o" : "x";
    }
    await this.persist();
    this.broadcast();
  }

  private async restart(ws: WebSocket): Promise<void> {
    const room = this.room;
    if (!room) return;
    const seat = attachment(ws);
    if (seat.role !== "x" && seat.role !== "o") {
      this.send(ws, { type: "error", message: "Solo los jugadores pueden reiniciar." });
      return;
    }
    if (!room.x || !room.o) {
      this.send(ws, { type: "error", message: "Falta un jugador para empezar." });
      return;
    }
    room.round += 1;
    room.board = emptyBoard();
    room.winner = null;
    room.winningLine = null;
    room.turn = room.round % 2 === 1 ? "x" : "o";
    await this.persist();
    this.broadcast();
  }

  private seat(ws: WebSocket, role: Role, token: string | null) {
    ws.serializeAttachment({ role, token } satisfies Attachment);
  }

  private welcome(ws: WebSocket, role: Role, token: string | null) {
    this.send(ws, { type: "welcome", role, token, code: this.room?.code });
  }

  private broadcast() {
    const room = this.room;
    if (!room) return;
    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, this.view(room, attachment(socket).role));
    }
  }

  private view(room: Room, you: Role) {
    return {
      type: "state" as const,
      code: room.code,
      phase: phaseOf(room),
      you,
      players: {
        x: publicPlayer(room.x),
        o: publicPlayer(room.o),
      },
      board: room.board,
      turn: room.turn,
      winner: room.winner,
      winningLine: room.winningLine,
      scores: room.scores,
      round: room.round,
    };
  }

  private send(ws: WebSocket, payload: unknown) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // The socket is already closing.
    }
  }

  private async persist() {
    if (!this.room) return;
    this.room.updatedAt = Date.now();
    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }
}

function attachment(ws: WebSocket): Attachment {
  const raw = ws.deserializeAttachment() as Attachment | null;
  if (!raw || (raw.role !== "x" && raw.role !== "o" && raw.role !== "spectator")) {
    return { role: "spectator", token: null };
  }
  return raw;
}

function judge(board: Cell[]): { winner: Mark; line: number[] } | { winner: "draw"; line: null } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) {
      return { winner: mark, line: [a, b, c] };
    }
  }
  if (board.every((cell) => cell !== null)) return { winner: "draw", line: null };
  return null;
}
