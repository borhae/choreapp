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
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../data/avatars'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const finalExt = allowed.includes(ext) ? ext : '.png';
    cb(null, uuidv4() + finalExt);
  }
});
function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  cb(null, true);
}
const upload = multer({ storage, fileFilter });
const memoryUpload = multer({ storage: multer.memoryStorage(), fileFilter });

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
    const dedupe = (arr, key) => {
      const map = new Map();
      arr.forEach(item => {
        const k = key(item);
        if (!map.has(k)) map.set(k, item);
      });
      return Array.from(map.values());
    };
    db.data.groups = dedupe(
      db.data.groups.map(g => ({ ...g, name: (g.name || '').trim() })),
      g => g.name.toLowerCase()
    );
    db.data.chores = dedupe(
      db.data.chores.map(c => ({ ...c, name: (c.name || '').trim() })),
      c => `${c.name.toLowerCase()}|${c.groupId || ''}`
    );
    db.data.weeklyGoals = dedupe(
      db.data.weeklyGoals.map(g => ({ ...g, name: (g.name || '').trim() })),
      g => `${g.name.toLowerCase()}|${g.groupId || ''}`
    );
  }
  await db.write();
}
initDB();

// Secret used for signing JWT tokens. Can be overridden by the SECRET
// environment variable.
const SECRET = process.env.SECRET || 'replace-this-secret';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

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

function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (!payload.admin) throw new Error('Not admin');
    next();
  } catch (err) {
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

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ admin: true }, SECRET, { expiresIn: '1d' });
    return res.json({ token });
  }
  res.status(400).json({ error: 'Invalid credentials' });
});

app.get('/api/groups/autocomplete', authMiddleware, async (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  await db.read();
  const results = db.data.groups.filter(g => g.name.toLowerCase().startsWith(query));
  const names = [...new Set(results.map(g => g.name))];
  res.json(names);
});

app.post('/api/groups', authMiddleware, async (req, res) => {
  let { name } = req.body;
  name = (name || '').trim();
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
  let { name, group } = req.body;
  name = (name || '').trim();
  group = (group || '').trim();
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
  const names = [...new Set(results.map(c => c.name))];
  res.json(names);
});

app.post('/api/chores', authMiddleware, async (req, res) => {
  let { name, ts, group } = req.body;
  name = (name || '').trim();
  group = (group || '').trim();
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
app.post('/api/users/avatar', authMiddleware, (req, res) => {
  upload.single('avatar')(req, res, async err => {
    if (err) {
      return res.status(400).json({ error: 'Only image files allowed' });
    }
    await db.read();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.body.builtin) {
      user.avatar = req.body.builtin;
      await db.write();
      broadcastUpdate();
      return res.json({ message: 'Avatar updated', avatar: user.avatar });
    }
    if (req.body.existing) {
      const file = decodeURIComponent(path.basename(req.body.existing));
      const filePath = path.join(avatarsDir, file);
      if (!filePath.startsWith(avatarsDir) || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Invalid file' });
      }
      user.avatar = file;
      await db.write();
      broadcastUpdate();
      return res.json({ message: 'Avatar updated', avatar: user.avatar });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });
    user.avatar = req.file.filename;
    await db.write();
    broadcastUpdate();
    res.json({ message: 'Avatar updated', avatar: user.avatar });
  });
});

// Update username
app.post('/api/users/username', authMiddleware, async (req, res) => {
  let { username } = req.body;
  username = (username || '').trim();
  if (!username) return res.status(400).json({ error: 'Missing username' });
  await db.read();
  const conflict = db.data.users.find(u => u.username === username && u.id !== req.user.id);
  if (conflict) return res.status(400).json({ error: 'Username taken' });
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.username = username;
  await db.write();
  broadcastUpdate();
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '1d' });
  res.json({ message: 'Username updated', username: user.username, token });
});

app.get('/api/avatars', authMiddleware, async (req, res) => {
  fs.readdir(avatarsDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read avatars' });
    res.json(files);
  });
});

app.get('/api/admin/avatars', adminAuthMiddleware, async (req, res) => {
  fs.readdir(avatarsDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read avatars' });
    res.json(files);
  });
});

app.delete('/api/admin/avatars/:file', adminAuthMiddleware, async (req, res) => {
  const filename = req.params.file;
  const filePath = path.join(avatarsDir, filename);
  if (!filePath.startsWith(avatarsDir)) {
    return res.status(400).json({ error: 'Invalid file' });
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.read();
    let changed = false;
    db.data.users.forEach(u => {
      if (u.avatar === filename) { u.avatar = ''; changed = true; }
    });
    if (changed) { await db.write(); broadcastUpdate(); }
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.post('/api/ocr', memoryUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const form = new FormData();
  form.append('image', new Blob([req.file.buffer]), req.file.originalname);
  const ocrHost = process.env.OCR_HOST || 'localhost';
  const ocrPort = process.env.OCR_PORT || 5000;
  console.log(`Sending OCR request to http://${ocrHost}:${ocrPort}/api/ocr`);
  try {
    const response = await fetch(`http://${ocrHost}:${ocrPort}/api/ocr`, { method: 'POST', body: form });
    const data = await response.json();
    console.log('OCR server responded with status', response.status);
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Error contacting OCR server:', err);
    res.status(500).json({ error: 'Failed to contact OCR server' });
  }
});

app.post('/api/ocr/preview', memoryUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const form = new FormData();
  form.append('image', new Blob([req.file.buffer]), req.file.originalname);
  const ocrHost = process.env.OCR_HOST || 'localhost';
  const ocrPort = process.env.OCR_PORT || 5000;
  console.log(`Sending preview request to http://${ocrHost}:${ocrPort}/api/preprocess`);
  try {
    const response = await fetch(`http://${ocrHost}:${ocrPort}/api/preprocess`, { method: 'POST', body: form });
    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', response.headers.get('Content-Type') || 'image/png');
    res.send(buf);
  } catch (err) {
    console.error('Error contacting OCR server:', err);
    res.status(500).json({ error: 'Failed to contact OCR server' });
  }
});

app.use(express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;
console.log('Configuration:');
console.log(' PORT:', PORT);
console.log(' DB_FILE:', dbFile);
console.log(' OCR_HOST:', process.env.OCR_HOST || 'localhost');
console.log(' OCR_PORT:', process.env.OCR_PORT || 5000);
console.log(' ADMIN_USER:', ADMIN_USER);
console.log(' ADMIN_PASS:', ADMIN_PASS ? '***' : '(default)');
console.log(' SECRET set:', !!process.env.SECRET);
server.listen(PORT, () => console.log('Server listening on', PORT));
