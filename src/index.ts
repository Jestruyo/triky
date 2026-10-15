import type { Env } from "./env";

export { GameRoom } from "./game-room";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

function roomCode(value: string): string | null {
  const code = value.toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(env);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(?:\/ws)?$/);
    if (match) {
      const code = roomCode(match[1]);
      if (!code) {
        return Response.json({ exists: false, error: "Código inválido." }, { status: 400 });
      }
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "No encontrado" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
    const response = await stub.fetch("https://room.internal/create", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (response.status === 409) continue;
    if (!response.ok) {
      return Response.json({ error: "No se pudo crear la sala." }, { status: 500 });
    }
    return Response.json({ code });
  }
  return Response.json({ error: "No se pudo crear la sala." }, { status: 500 });
}
