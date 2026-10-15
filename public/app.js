const MARKS = {
  x: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M26 26 L74 74 M74 26 L26 74" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></svg>',
  o: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="24" fill="none" stroke="currentColor" stroke-width="12"/></svg>',
};

const homeEl = document.querySelector("#home");
const gameEl = document.querySelector("#game");
const footerEl = document.querySelector("#footer");
const formEl = document.querySelector("#play-form");
const nameEl = document.querySelector("#name");
const codeEl = document.querySelector("#code-input");
const createBlock = document.querySelector("#create-block");
const inviteEl = document.querySelector("#invite");
const inviteCodeEl = document.querySelector("#invite-code");
const enterBtn = document.querySelector("#enter-btn");
const createBtn = document.querySelector("#create-btn");
const joinBtn = document.querySelector("#join-btn");
const homeError = document.querySelector("#home-error");
const brandEl = document.querySelector("#brand");
const shareBtn = document.querySelector("#share-btn");
const statusEl = document.querySelector("#status");
const boardEl = document.querySelector("#board");
const restartBtn = document.querySelector("#restart-btn");
const leaveBtn = document.querySelector("#leave-btn");
const confirmEl = document.querySelector("#confirm");
const confirmYes = document.querySelector("#confirm-yes");
const confirmNo = document.querySelector("#confirm-no");
const toastEl = document.querySelector("#toast");
const cardX = document.querySelector("#card-x");
const cardO = document.querySelector("#card-o");
const nameX = document.querySelector("#name-x");
const nameO = document.querySelector("#name-o");
const scoreX = document.querySelector("#score-x");
const scoreO = document.querySelector("#score-o");

const cells = [];
const painted = Array(9).fill(undefined);
let roomCode = "";
let socket = null;
let fatal = false;
let latest = null;
let reconnectAttempt = 0;
let reconnectTimer = 0;
let pingTimer = 0;
let toastTimer = 0;

for (let index = 0; index < 9; index += 1) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "cell";
  cell.dataset.index = String(index);
  cell.disabled = true;
  cell.addEventListener("click", () => play(index));
  boardEl.appendChild(cell);
  cells.push(cell);
}

nameEl.value = localStorage.getItem("triky:name") || "";
nameEl.addEventListener("input", () => {
  homeError.textContent = "";
});
codeEl.addEventListener("input", () => {
  codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  homeError.textContent = "";
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!enterBtn.hidden) joinFromInvite();
  else createRoom();
});
joinBtn.addEventListener("click", joinWithCode);
shareBtn.addEventListener("click", shareRoom);
brandEl.addEventListener("click", copyCode);
restartBtn.addEventListener("click", askRestart);
confirmYes.addEventListener("click", () => {
  confirmEl.hidden = true;
  restartBtn.hidden = false;
  leaveBtn.hidden = false;
  send({ type: "restart" });
});
confirmNo.addEventListener("click", () => {
  confirmEl.hidden = true;
  restartBtn.hidden = false;
  leaveBtn.hidden = false;
});
leaveBtn.addEventListener("click", leaveRoom);
window.addEventListener("popstate", boot);

boot();

function salaFromUrl() {
  const value = new URLSearchParams(location.search).get("sala") || "";
  const code = value.toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : "";
}

function savedName() {
  return nameEl.value.trim().replace(/\s+/g, " ").slice(0, 18);
}

function rememberName() {
  const name = savedName();
  if (name) localStorage.setItem("triky:name", name);
  return name;
}

async function boot() {
  stopConnection();
  const sala = salaFromUrl();
  latest = null;
  if (!sala) {
    showHome("");
    return;
  }
  const name = localStorage.getItem("triky:name") || "";
  const token = localStorage.getItem(`triky:token:${sala}`) || "";
  if (name && token) {
    nameEl.value = name;
    enterGame(sala);
    return;
  }
  try {
    const response = await fetch(`/api/rooms/${sala}`);
    if (!response.ok) {
      showHome("Esa sala no existe o ya expiró.");
      return;
    }
    showInvite(sala);
  } catch {
    showHome("No se pudo abrir la sala.");
  }
}

function showHome(message) {
  roomCode = "";
  document.title = "Triky";
  homeEl.hidden = false;
  gameEl.hidden = true;
  footerEl.hidden = true;
  shareBtn.hidden = true;
  inviteEl.hidden = true;
  enterBtn.hidden = true;
  createBlock.hidden = false;
  brandEl.textContent = "Triky";
  brandEl.classList.remove("is-code");
  homeError.textContent = message || "";
}

function showInvite(code) {
  roomCode = code;
  document.title = `Triky · ${code}`;
  homeEl.hidden = false;
  gameEl.hidden = true;
  footerEl.hidden = true;
  shareBtn.hidden = true;
  createBlock.hidden = true;
  inviteEl.hidden = false;
  enterBtn.hidden = false;
  inviteCodeEl.textContent = code;
  brandEl.textContent = code;
  brandEl.classList.add("is-code");
  homeError.textContent = "";
}

async function createRoom() {
  const name = rememberName();
  if (!name) {
    homeError.textContent = "Escribe tu nombre para crear la sala.";
    nameEl.focus();
    return;
  }
  createBtn.disabled = true;
  createBtn.textContent = "Creando sala…";
  homeError.textContent = "";
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.code) throw new Error(data.error || "No se pudo crear la sala.");
    const url = new URL(location.href);
    url.searchParams.set("sala", data.code);
    history.pushState({ sala: data.code }, "", url);
    enterGame(data.code);
  } catch (error) {
    homeError.textContent = error.message || "No se pudo crear la sala.";
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = "Crear partida";
  }
}

async function joinWithCode() {
  const name = rememberName();
  const code = codeEl.value.trim().toUpperCase();
  if (!name) {
    homeError.textContent = "Escribe tu nombre para unirte.";
    nameEl.focus();
    return;
  }
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    homeError.textContent = "El código tiene 6 caracteres.";
    codeEl.focus();
    return;
  }
  joinBtn.disabled = true;
  try {
    const response = await fetch(`/api/rooms/${code}`);
    if (!response.ok) {
      homeError.textContent = "No encontramos esa sala.";
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set("sala", code);
    history.pushState({ sala: code }, "", url);
    enterGame(code);
  } finally {
    joinBtn.disabled = false;
  }
}

function joinFromInvite() {
  const name = rememberName();
  if (!name) {
    homeError.textContent = "Escribe tu nombre para entrar.";
    nameEl.focus();
    return;
  }
  enterGame(roomCode);
}

function enterGame(code) {
  roomCode = code;
  painted.fill(undefined);
  homeEl.hidden = true;
  gameEl.hidden = false;
  footerEl.hidden = false;
  shareBtn.hidden = false;
  confirmEl.hidden = true;
  restartBtn.hidden = false;
  leaveBtn.hidden = false;
  brandEl.textContent = code;
  brandEl.classList.add("is-code");
  document.title = `Triky · ${code}`;
  statusEl.textContent = "Conectando…";
  connect(code);
}

function connect(code) {
  fatal = false;
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${code}/ws`);
  socket = ws;
  ws.onopen = () => {
    reconnectAttempt = 0;
    const name = localStorage.getItem("triky:name") || "";
    const token = localStorage.getItem(`triky:token:${code}`) || "";
    ws.send(JSON.stringify({ type: "join", name, token }));
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome" && message.token) {
      localStorage.setItem(`triky:token:${code}`, message.token);
    }
    if (message.type === "state") render(message);
    if (message.type === "error") {
      toast(message.message);
      if (message.fatal) {
        fatal = true;
        ws.close();
        showHome(message.message);
      }
    }
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    if (socket !== ws || fatal || roomCode !== code) return;
    reconnectAttempt += 1;
    if (reconnectAttempt > 8) {
      statusEl.textContent = "Se perdió la conexión.";
      return;
    }
    statusEl.textContent = "Reconectando…";
    reconnectTimer = setTimeout(() => {
      if (!fatal && roomCode === code) connect(code);
    }, Math.min(4000, 400 * reconnectAttempt));
  };
  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }, 25000);
}

function stopConnection() {
  fatal = true;
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function play(index) {
  if (!latest || latest.phase !== "playing" || latest.you !== latest.turn) return;
  if (latest.board[index]) return;
  send({ type: "move", i: index });
}

function askRestart() {
  if (!latest || (latest.you !== "x" && latest.you !== "o")) return;
  const started = latest.board.some(Boolean) && latest.phase === "playing";
  if (!started) {
    send({ type: "restart" });
    return;
  }
  confirmEl.hidden = false;
  restartBtn.hidden = true;
  leaveBtn.hidden = true;
}

function leaveRoom() {
  stopConnection();
  history.pushState({}, "", location.pathname);
  showHome("");
}

function render(state) {
  latest = state;
  const x = state.players.x;
  const o = state.players.o;
  paintPlayer(cardX, nameX, scoreX, "x", x, state);
  paintPlayer(cardO, nameO, scoreO, "o", o, state);
  statusEl.textContent = statusText(state);
  restartBtn.disabled = state.you === "spectator" || state.phase === "waiting";

  state.board.forEach((mark, index) => {
    const cell = cells[index];
    if (painted[index] !== mark) {
      painted[index] = mark;
      cell.innerHTML = mark ? MARKS[mark] : "";
    }
    const winning = Array.isArray(state.winningLine) && state.winningLine.includes(index);
    cell.classList.toggle("win", winning);
    const canPlay = state.phase === "playing" && state.you === state.turn && !mark;
    cell.disabled = !canPlay;
    cell.setAttribute(
      "aria-label",
      mark ? `${mark.toUpperCase()} en la casilla ${index + 1}` : `Casilla ${index + 1}`,
    );
  });
}

function paintPlayer(card, nameNode, scoreNode, mark, player, state) {
  const active = state.phase === "playing" && state.turn === mark;
  card.classList.toggle("active", active);
  card.classList.toggle("idle", !player);
  if (!player) {
    nameNode.textContent = "Esperando";
    nameNode.classList.add("placeholder");
    scoreNode.textContent = "-";
    return;
  }
  const mine = state.you === mark ? " (tú)" : "";
  const offline = player.connected ? "" : " · sin conexión";
  nameNode.textContent = `${player.name}${mine}${offline}`;
  nameNode.classList.remove("placeholder");
  nameNode.title = player.name;
  scoreNode.textContent = String(state.scores[mark]);
}

function statusText(state) {
  const current = state.turn === "x" ? state.players.x : state.players.o;
  if (state.phase === "waiting") {
    if (state.you === "x") return "Comparte el código para que entre la otra persona";
    if (state.you === "o") return "Entrando a la sala…";
    return "Esperando a los dos jugadores";
  }
  if (state.phase === "finished") {
    if (state.winner === "draw") return "Empate";
    if (state.you === state.winner) return "Ganaste";
    const winner = state.winner === "x" ? state.players.x : state.players.o;
    return winner ? `Ganó ${winner.name}` : "Partida terminada";
  }
  if (current && !current.connected) return `Turno de ${current.name}, que está desconectado`;
  if (state.you === state.turn) return "Tu turno";
  return `Turno de ${current ? current.name : "el otro jugador"}`;
}

async function shareRoom() {
  if (!roomCode) return;
  const url = `${location.origin}/?sala=${roomCode}`;
  const payload = { title: "Triky", text: `Juguemos Triky. Código ${roomCode}`, url };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  await copyText(url, "Enlace copiado");
}

async function copyCode() {
  if (!roomCode) return;
  await copyText(roomCode, "Código copiado");
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch {
    toast(value);
  }
}

function toast(message) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2400);
}
