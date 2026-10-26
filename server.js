const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, maxHttpBufferSize: 2e6 });
const PORT = Number(process.env.PORT || 3000);
const GM_PIN = String(process.env.GM_PIN || '2468');
const DATA_FILE = path.join(__dirname, 'rooms.json');
let rooms = {};
const members = new Map();
try { rooms = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
function saveRooms(){ try { fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2)); } catch(e){ console.error('Could not persist rooms:', e.message); } }
function cleanRoom(s){ return String(s || 'ABYSS').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,32) || 'ABYSS'; }
function cleanName(s){ return String(s || 'Игрок').trim().slice(0,40) || 'Игрок'; }
function defaultRoom(){ return {mapW:14,mapH:10,cells:{},tokens:{},mapImage:'',characters:[],combatants:[],round:1,turn:-1,diceLog:[],enemies:[],notes:'',sceneTitle:''}; }
function roomMembers(room){ return [...members.entries()].filter(([id,m])=>m.room===room).map(([id,m])=>({id,name:m.name,role:m.role})); }
function emitMembers(room){ io.to(room).emit('room:members', roomMembers(room)); }
function validMember(socket, room){ const m=members.get(socket.id); return m && m.room===room ? m : null; }
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_,res)=>res.json({ok:true, app:'Deepwoken Tabletop', version:2}));
app.get('/config', (_,res)=>res.json({gmPinRequired:true, note:'GM_PIN environment variable; default PIN is 2468. Change it before internet deployment.'}));

io.on('connection', socket => {
  socket.on('room:join', data => {
    const room = cleanRoom(data?.room);
    const name = cleanName(data?.name);
    const requestedRole = data?.role === 'gm' ? 'gm' : 'player';
    if (requestedRole === 'gm' && String(data?.gmPin || '') !== GM_PIN) {
      socket.emit('auth:error', 'Неверный PIN ведущего. Установи GM_PIN на сервере и введи его здесь.');
      return;
    }
    if (members.has(socket.id)) {
      const old = members.get(socket.id);
      socket.leave(old.room);
      members.delete(socket.id);
      emitMembers(old.room);
    }
    if (!rooms[room]) rooms[room] = defaultRoom();
    const member = { room, name, role: requestedRole };
    members.set(socket.id, member);
    socket.join(room);
    socket.emit('room:state', rooms[room]);
    emitMembers(room);
  });

  // Only an authenticated GM can publish full room state.
  socket.on('state:update', payload => {
    const room = cleanRoom(payload?.room);
    const member = validMember(socket, room);
    if (!member || member.role !== 'gm' || !payload?.state || typeof payload.state !== 'object') return;
    const next = JSON.parse(JSON.stringify(payload.state));
    delete next.members;
    // Bound uploaded map data to avoid giant room files.
    if (typeof next.mapImage === 'string' && next.mapImage.length > 1_600_000) next.mapImage = '';
    rooms[room] = next;
    saveRooms();
    io.to(room).emit('room:state', next);
  });

  // Players can only create/update a character owned by their connection name.
  socket.on('sheet:save', payload => {
    const room = cleanRoom(payload?.room), member = validMember(socket, room), c = payload?.character;
    if (!member || !c || typeof c !== 'object' || !String(c.name || '').trim()) return;
    const state = rooms[room] || (rooms[room] = defaultRoom());
    const chars = Array.isArray(state.characters) ? state.characters : (state.characters = []);
    const existing = chars.find(x => x.id === c.id);
    if (existing && member.role !== 'gm' && existing.owner !== member.name) return;
    const saved = {...c, owner: member.role === 'gm' ? cleanName(c.owner || member.name) : member.name};
    const idx = chars.findIndex(x => x.id === saved.id);
    if (idx >= 0) chars[idx] = saved; else chars.push(saved);
    saveRooms();
    io.to(room).emit('room:state', state);
  });

  socket.on('sheet:delete', payload => {
    const room = cleanRoom(payload?.room), member = validMember(socket, room);
    if (!member) return;
    const state = rooms[room]; if (!state) return;
    const target = (state.characters || []).find(c => c.id === payload?.id);
    if (!target || (member.role !== 'gm' && target.owner !== member.name)) return;
    state.characters = state.characters.filter(c => c.id !== payload.id);
    saveRooms(); io.to(room).emit('room:state', state);
  });

  socket.on('dice:roll', payload => {
    const room = cleanRoom(payload?.room), member = validMember(socket, room);
    if (!member) return;
    const state = rooms[room] || (rooms[room] = defaultRoom());
    state.diceLog = Array.isArray(state.diceLog) ? state.diceLog : [];
    const entry = String(payload?.entry || '').slice(0,180);
    if (!entry) return;
    state.diceLog.unshift(entry); state.diceLog = state.diceLog.slice(0,40);
    saveRooms(); io.to(room).emit('room:state', state);
  });

  socket.on('disconnect', () => {
    const member = members.get(socket.id);
    if (member) { members.delete(socket.id); emitMembers(member.room); }
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Deepwoken Tabletop v2: http://localhost:${PORT} | GM_PIN is set via environment (default 2468)`));
