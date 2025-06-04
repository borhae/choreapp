import express from 'express';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { users: [], chores: [], logs: [] });

async function initDB() {
  await db.read();
  db.data ||= { users: [], chores: [], logs: [] };
  await db.write();
}
initDB();

const SECRET = 'replace-this-secret';

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
  const user = { id: uuidv4(), username, password: hashed };
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

app.get('/api/chores/autocomplete', authMiddleware, async (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  await db.read();
  const results = db.data.chores.filter(c => c.name.toLowerCase().startsWith(query));
  res.json(results.map(c => c.name));
});

app.post('/api/chores', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing chore name' });
  await db.read();
  let chore = db.data.chores.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!chore) {
    chore = { id: uuidv4(), name };
    db.data.chores.push(chore);
  }
  const log = { id: uuidv4(), userId: req.user.id, choreId: chore.id, ts: Date.now() };
  db.data.logs.push(log);
  await db.write();
  res.json({ message: 'Logged', log });
});

app.get('/api/logs', authMiddleware, async (req, res) => {
  await db.read();
  const userLogs = db.data.logs.filter(l => l.userId === req.user.id);
  const logsWithNames = userLogs.map(l => {
    const chore = db.data.chores.find(c => c.id === l.choreId);
    return { ...l, chore: chore ? chore.name : 'unknown' };
  });
  res.json(logsWithNames);
});

app.get('/api/logs/all', authMiddleware, async (req, res) => {
  await db.read();
  const logs = db.data.logs.map(l => {
    const user = db.data.users.find(u => u.id === l.userId);
    const chore = db.data.chores.find(c => c.id === l.choreId);
    return {
      ...l,
      user: user ? user.username : 'unknown',
      chore: chore ? chore.name : 'unknown',
    };
  });
  res.json(logs);
});

app.get('/api/summary', authMiddleware, async (req, res) => {
  const from = parseInt(req.query.from) || 0;
  const to = parseInt(req.query.to) || Date.now();
  await db.read();
  const filtered = db.data.logs.filter(l => l.ts >= from && l.ts <= to);
  const counts = {};
  for (const log of filtered) {
    counts[log.userId] ||= 0;
    counts[log.userId]++;
  }
  res.json(counts);
});

app.use(express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));
