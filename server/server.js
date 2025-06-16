import express from 'express';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const upload = multer({ dest: path.join(__dirname, '../data/avatars') });

function broadcastUpdate() {
  const msg = JSON.stringify({ type: 'update' });
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

const dbFile = process.env.DB_FILE || path.join(__dirname, '../data/db.json');
const dbDir = path.dirname(dbFile);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const avatarsDir = path.join(__dirname, '../data/avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { users: [], chores: [], logs: [], groups: [], weeklyGoals: [] });

async function initDB() {
  await db.read();
  if (!db.data) {
    db.data = { users: [], chores: [], logs: [], groups: [], weeklyGoals: [] };
  } else {
    if (!Array.isArray(db.data.users)) db.data.users = [];
    if (!Array.isArray(db.data.chores)) db.data.chores = [];
    if (!Array.isArray(db.data.logs)) db.data.logs = [];
    if (!Array.isArray(db.data.groups)) db.data.groups = [];
    if (!Array.isArray(db.data.weeklyGoals)) db.data.weeklyGoals = [];
    db.data.users.forEach(u => { if (!('avatar' in u)) u.avatar = ''; });
  }
  await db.write();
}
initDB();

// Secret used for signing JWT tokens. Can be overridden by the SECRET
// environment variable.
const SECRET = process.env.SECRET || 'replace-this-secret';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  await db.read();
  if (db.data.users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'User exists' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hashed, avatar: '' };
  db.data.users.push(user);
  await db.write();
  res.json({ message: 'Registered' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign(
    { id: user.id, username: user.username },
    SECRET,
    { expiresIn: '1d' }
  );
  res.json({ token });
});

app.get('/api/groups/autocomplete', authMiddleware, async (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  await db.read();
  const results = db.data.groups.filter(g => g.name.toLowerCase().startsWith(query));
  res.json(results.map(g => g.name));
});

app.post('/api/groups', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing group name' });
  await db.read();
  let group = db.data.groups.find(g => g.name.toLowerCase() === name.toLowerCase());
  if (!group) {
    group = { id: uuidv4(), name };
    db.data.groups.push(group);
    await db.write();
  }
  res.json(group);
});

app.get('/api/weekly-goals', authMiddleware, async (req, res) => {
  await db.read();
  const goals = db.data.weeklyGoals.map(g => {
    const group = g.groupId ? db.data.groups.find(gr => gr.id === g.groupId) : null;
    return { id: g.id, name: g.name, group: group ? group.name : '' };
  });
  res.json(goals);
});

app.post('/api/weekly-goals', authMiddleware, async (req, res) => {
  const { name, group } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing goal name' });
  await db.read();
  let groupId = null;
  if (group) {
    let g = db.data.groups.find(gr => gr.name.toLowerCase() === group.toLowerCase());
    if (!g) {
      g = { id: uuidv4(), name: group };
      db.data.groups.push(g);
    }
    groupId = g.id;
  }
  let goal = db.data.weeklyGoals.find(g => g.name.toLowerCase() === name.toLowerCase() && g.groupId === groupId);
  if (!goal) {
    goal = { id: uuidv4(), name, groupId };
    db.data.weeklyGoals.push(goal);
  }
  let chore = db.data.chores.find(c => c.name.toLowerCase() === name.toLowerCase() && c.groupId === groupId);
  if (!chore) {
    chore = { id: uuidv4(), name, groupId };
    db.data.chores.push(chore);
  }
  await db.write();
  broadcastUpdate();
  const groupName = group || '';
  res.json({ id: goal.id, name: goal.name, group: groupName });
});

app.get('/api/chores/autocomplete', authMiddleware, async (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  await db.read();
  const results = db.data.chores.filter(c => c.name.toLowerCase().startsWith(query));
  res.json(results.map(c => c.name));
});

app.post('/api/chores', authMiddleware, async (req, res) => {
  const { name, ts, group } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing chore name' });
  await db.read();
  let groupId = null;
  if (group) {
    let g = db.data.groups.find(gr => gr.name.toLowerCase() === group.toLowerCase());
    if (!g) {
      g = { id: uuidv4(), name: group };
      db.data.groups.push(g);
    }
    groupId = g.id;
  }
  let chore = db.data.chores.find(
    c => c.name.toLowerCase() === name.toLowerCase() && c.groupId === groupId
  );
  if (!chore) {
    chore = { id: uuidv4(), name, groupId };
    db.data.chores.push(chore);
  }
  const timestamp = Number.isFinite(Number(ts)) ? Number(ts) : Date.now();
  const log = { id: uuidv4(), userId: req.user.id, choreId: chore.id, ts: timestamp };
  db.data.logs.push(log);
  await db.write();
  broadcastUpdate();
  res.json({ message: 'Logged', log });
});

app.get('/api/logs', authMiddleware, async (req, res) => {
  await db.read();
  const userLogs = db.data.logs.filter(l => l.userId === req.user.id);
  const logsWithNames = userLogs.map(l => {
    const chore = db.data.chores.find(c => c.id === l.choreId);
    const group = chore ? db.data.groups.find(g => g.id === chore.groupId) : null;
    return {
      ...l,
      chore: chore ? chore.name : 'unknown',
      group: group ? group.name : ''
    };
  });
  res.json(logsWithNames);
});

app.get('/api/logs/all', authMiddleware, async (req, res) => {
  await db.read();
  const logs = db.data.logs.map(l => {
    const user = db.data.users.find(u => u.id === l.userId);
    const chore = db.data.chores.find(c => c.id === l.choreId);
    const group = chore ? db.data.groups.find(g => g.id === chore.groupId) : null;
    return {
      ...l,
      user: user ? user.username : 'unknown',
      chore: chore ? chore.name : 'unknown',
      group: group ? group.name : ''
    };
  });
  res.json(logs);
});

app.delete('/api/logs/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  await db.read();
  const index = db.data.logs.findIndex(l => l.id === id && l.userId === req.user.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Log not found' });
  }
  db.data.logs.splice(index, 1);
  await db.write();
  broadcastUpdate();
  res.json({ message: 'Deleted' });
});

app.get('/api/summary', authMiddleware, async (req, res) => {
  const from = parseInt(req.query.from) || 0;
  const to = parseInt(req.query.to) || Date.now();
  await db.read();
  const filtered = db.data.logs.filter(l => l.ts >= from && l.ts <= to);
  const counts = {};
  for (const log of filtered) {
    if (!counts[log.userId]) counts[log.userId] = 0;
    counts[log.userId]++;
  }
  res.json(counts);
});

app.get('/api/chores/top', authMiddleware, async (req, res) => {
  await db.read();
  const counts = {};
  for (const log of db.data.logs) {
    counts[log.choreId] = (counts[log.choreId] || 0) + 1;
  }
  const choresWithCounts = db.data.chores.map(c => ({
    ...c,
    count: counts[c.id] || 0
  }));
  choresWithCounts.sort((a, b) => b.count - a.count);
  const top = choresWithCounts.slice(0, 10).map(c => {
    const group = c.groupId ? db.data.groups.find(g => g.id === c.groupId) : null;
    return {
      id: c.id,
      name: c.name,
      group: group ? group.name : ''
    };
  });
  res.json(top);
});

// Serve uploaded avatars
app.use('/avatars', express.static(path.join(__dirname, '../data/avatars')));

// Get current user profile
app.get('/api/users/me', authMiddleware, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, avatar: user.avatar || '' });
});


// Update avatar: either upload a file or choose a built-in
app.post('/api/users/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.builtin) {
    user.avatar = req.body.builtin;
    await db.write();
    broadcastUpdate();
    return res.json({ message: 'Avatar updated', avatar: user.avatar });
  }
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = path.extname(req.file.originalname || '.png');
  const newName = user.id + ext;
  fs.renameSync(req.file.path, path.join(req.file.destination, newName));
  user.avatar = newName;
  await db.write();
  broadcastUpdate();
  res.json({ message: 'Avatar updated', avatar: user.avatar });
});

app.use(express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));
