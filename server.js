
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GM_PIN = process.env.GM_PIN || "2468";

app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "Deepwoken Tabletop" });
});

const rooms = new Map();

function createState() {
  return {
    mapW: 14,
    mapH: 10,
    cells: {},
    tokens: {},
    mapImage: "",
    characters: [],
    combatants: [],
    round: 1,
    turn: -1,
    diceLog: [],
    enemies: [],
    notes: "",
    sceneTitle: ""
  };
}

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      state: createState(),
      members: new Map()
    });
  }
  return rooms.get(code);
}

function sendMembers(code) {
  const room = rooms.get(code);
  if (!room) return;

  io.to(code).emit(
    "room:members",
    Array.from(room.members.values())
  );
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return;

  io.to(code).emit("room:state", room.state);
}

io.on("connection", (socket) => {
  socket.on("room:join", (data = {}) => {
    const code = String(data.room || "ABYSS")
      .trim()
      .toUpperCase()
      .slice(0, 32);

    const name = String(data.name || "Игрок")
      .trim()
      .slice(0, 40);

    const requestedRole = data.role === "gm" ? "gm" : "player";

    if (!code || !name) {
      socket.emit("auth:error", "Укажи имя и код комнаты.");
      return;
    }

    if (requestedRole === "gm" && String(data.gmPin || "") !== GM_PIN) {
      socket.emit("auth:error", "Неверный PIN ведущего.");
      return;
    }

    const room = getRoom(code);

    socket.data.roomCode = code;
    socket.data.playerName = name;
    socket.data.role = requestedRole;

    socket.join(code);

    room.members.set(socket.id, {
      id: socket.id,
      name,
      role: requestedRole
    });

    socket.emit("room:state", room.state);
    sendMembers(code);
  });

  socket.on("state:update", (data = {}) => {
    const code = socket.data.roomCode;
    if (!code || socket.data.role !== "gm") return;
    if (data.room !== code || !data.state || typeof data.state !== "object") return;

    const room = rooms.get(code);
    if (!room) return;

    room.state = data.state;
    broadcastState(code);
  });

  socket.on("sheet:save", (data = {}) => {
    const code = socket.data.roomCode;
    if (!code || data.room !== code || !data.character) return;

    const room = rooms.get(code);
    if (!room) return;

    const character = data.character;
    if (typeof character !== "object" || !character.id) return;

    const characters = room.state.characters;
    const index = characters.findIndex((c) => c.id === character.id);

    if (index >= 0) {
      if (
        characters[index].owner &&
        characters[index].owner !== socket.data.playerName &&
        socket.data.role !== "gm"
      ) {
        return;
      }

      characters[index] = character;
    } else {
      character.owner = character.owner || socket.data.playerName;
      characters.push(character);
    }

    broadcastState(code);
  });

  socket.on("sheet:delete", (data = {}) => {
    const code = socket.data.roomCode;
    if (!code || data.room !== code || !data.id) return;

    const room = rooms.get(code);
    if (!room) return;

    const character = room.state.characters.find(
      (c) => c.id === data.id
    );

    if (!character) return;

    if (
      socket.data.role !== "gm" &&
      character.owner !== socket.data.playerName
    ) {
      return;
    }

    room.state.characters = room.state.characters.filter(
      (c) => c.id !== data.id
    );

    broadcastState(code);
  });

  socket.on("dice:roll", (data = {}) => {
    const code = socket.data.roomCode;
    if (!code || data.room !== code || typeof data.entry !== "string") return;

    const room = rooms.get(code);
    if (!room) return;

    room.state.diceLog.unshift(
      data.entry.slice(0, 250)
    );
    room.state.diceLog = room.state.diceLog.slice(0, 40);

    broadcastState(code);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.members.delete(socket.id);
    sendMembers(code);

    if (room.members.size === 0) {
      rooms.delete(code);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Deepwoken Tabletop запущен на порту ${PORT}`);
});
