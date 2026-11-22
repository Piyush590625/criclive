const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB = path.join(__dirname, 'db.json');
const SECRET = process.env.JWT_SECRET;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const rapidKey = process.env.RAPIDAPI_KEY || '';
const rapidHost = process.env.RAPIDAPI_HOST || 'cricbuzz-cricket.p.rapidapi.com';
const cricketDataKey = process.env.CRICKETDATA_API_KEY || '';
const cricketDataBase = (process.env.CRICKETDATA_BASE_URL || 'https://api.cricketdata.org').replace(/\/$/, '');
const mailer = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && !process.env.GMAIL_APP_PASSWORD.startsWith('your-')
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } }) : null;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be set and be at least 32 characters');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars) must be set');

app.use(express.json({ limit: '100kb' }));
const requestCounts = new Map();
app.use((req, res, next) => {
  const key = `${req.ip}|${req.path}`, now = Date.now(), entry = requestCounts.get(key);
  if (!entry || now - entry.started > 60000) { requestCounts.set(key, { started: now, count: 1 }); return next(); }
  if (++entry.count > 120) return res.status(429).json({ error: 'Too many requests' });
  next();
});

const seed = { users: [{ id: 1, name: 'Admin', email: ADMIN_EMAIL, password: bcrypt.hashSync(ADMIN_PASSWORD, 10), role: 'admin', favorites: [] }], matches: [], news: [], rankings: [], comments: [], poll: { question: 'Who wins the next big match?', options: [] } };
function localLoad() { if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seed, null, 2)); return JSON.parse(fs.readFileSync(DB, 'utf8')); }
function localSave(data) { fs.writeFileSync(DB, JSON.stringify(data, null, 2)); }
async function query(text, params = []) { if (!pool) throw new Error('DATABASE_URL is not configured'); return pool.query(text, params); }
async function sendOtp(email, otp) { if (!mailer) { console.log(`[CricLive] Verification OTP for ${email}: ${otp}`); return; } await mailer.sendMail({ from: `CricLive <${process.env.GMAIL_USER}>`, to: email, subject: 'Your CricLive verification code', text: `Your CricLive verification code is ${otp}. It expires in 10 minutes.` }); }
function auth(req, res, next) { try { req.user = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SECRET); next(); } catch { res.status(401).json({ error: 'Authentication required' }); } }
function admin(req, res, next) { if (req.user.role !== 'admin') return res.sendStatus(403); next(); }

function flattenRapid(payload, source) {
  const output = [];
  for (const type of payload?.typeMatches || []) for (const series of type.seriesMatches || []) {
    const wrapper = series.seriesAdWrapper; if (!wrapper) continue;
    for (const item of wrapper.matches || []) {
      const info = item.matchInfo || {}, score = item.matchScore || {}, a = score.team1Score?.inngs1 || {}, b = score.team2Score?.inngs1 || {};
      output.push({ id: String(info.matchId), series: info.seriesName || wrapper.seriesName || '', title: `${info.team1?.teamSName || info.team1?.teamName || 'Team 1'} vs ${info.team2?.teamSName || info.team2?.teamName || 'Team 2'}`, short: `${info.team1?.teamSName || ''} v ${info.team2?.teamSName || ''}`, status: /live|progress/i.test(info.state || '') ? 'LIVE' : /complete|finished|won|abandon|cancel/i.test(`${info.state || ''} ${info.status || ''}`) ? 'COMPLETED' : 'UPCOMING', category: type.matchType || 'International', venue: [info.venueInfo?.ground, info.venueInfo?.city].filter(Boolean).join(', '), date: info.startDate ? new Date(Number(info.startDate)).toLocaleString() : '', format: info.matchFormat || '', team1: info.team1?.teamName || '', team2: info.team2?.teamName || '', score1: a.runs != null ? `${a.runs}/${a.wickets ?? 0}` : '', score2: b.runs != null ? `${b.runs}/${b.wickets ?? 0}` : '', overs: a.overs ? `${a.overs} ov` : '', result: info.status || info.state || '', source });
    }
  }
  return output;
}
const providerCache = new Map();
async function fetchJson(url, options) { const response = await fetch(url, options); if (!response.ok) throw new Error(`Provider ${response.status}`); return response.json(); }
async function rapidMatches(kind) { if (!rapidKey) return []; const cached = providerCache.get(`rapid:${kind}`); if (cached && Date.now() - cached.at < 60000) return cached.data; const data = flattenRapid(await fetchJson(`https://${rapidHost}/matches/v1/${kind}`, { headers: { 'X-RapidAPI-Key': rapidKey, 'X-RapidAPI-Host': rapidHost, 'CB-Loc': 'IN', 'CB-TZ': '+0530' } }), kind); providerCache.set(`rapid:${kind}`, { at: Date.now(), data }); return data; }
function normalizeCricketData(payload) { const rows = payload?.data || payload?.matches || payload?.response || []; return (Array.isArray(rows) ? rows : []).map((m, i) => ({ id: String(m.id || m.match_id || m.matchId || `cricketdata-${i}`), title: m.name || m.title || `${m.teams?.[0] || 'Team 1'} vs ${m.teams?.[1] || 'Team 2'}`, short: '', status: /live|in progress/i.test(`${m.status || ''} ${m.matchStarted || ''}`) ? 'LIVE' : /complete|finished|ended/i.test(m.status || '') ? 'COMPLETED' : 'UPCOMING', category: m.matchType || m.type || 'Cricket', venue: m.venue || '', date: m.dateTimeGMT || m.date || '', format: m.matchType || '', team1: m.teams?.[0] || m.team1 || '', team2: m.teams?.[1] || m.team2 || '', score1: m.score?.[0]?.r != null ? `${m.score[0].r}/${m.score[0].w || 0}` : '', score2: m.score?.[1]?.r != null ? `${m.score[1].r}/${m.score[1].w || 0}` : '', overs: m.score?.[0]?.o ? `${m.score[0].o} ov` : '', result: m.status || '', source: 'cricketdata' })); }
async function cricketDataMatches() { if (!cricketDataKey) return []; const cached = providerCache.get('cricketdata'); if (cached && Date.now() - cached.at < 15 * 60000) return cached.data; const data = normalizeCricketData(await fetchJson(`${cricketDataBase}/matches`, { headers: { Authorization: `Bearer ${cricketDataKey}`, 'x-api-key': cricketDataKey } })); providerCache.set('cricketdata', { at: Date.now(), data }); return data; }
async function liveMatches() { const results = await Promise.allSettled([rapidMatches('live'), rapidMatches('recent'), rapidMatches('upcoming'), cricketDataMatches()]); const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []); const unique = new Map(all.map(m => [m.id, m])); return [...unique.values()]; }

app.get('/api/health', async (req, res) => { let database = 'local-json'; if (pool) { try { await query('select 1'); database = 'supabase-postgres'; } catch { database = 'database-error'; } } res.json({ ok: database !== 'database-error', service: 'CricLive', database }); });
app.get('/api/live-matches', async (req, res) => { try { const category = String(req.query.category || '').toLowerCase(); const matches = (await liveMatches()).filter(m => !category || String(m.category).toLowerCase() === category); res.json({ source: matches.some(m => m.source === 'rapid') ? 'providers' : 'cricketdata', cached: true, matches }); } catch { const data = localLoad(); res.json({ source: 'mock-fallback', matches: data.matches || [] }); } });

app.post('/api/auth/register', async (req, res) => { const { name, email, password } = req.body; const normalized = String(email || '').trim().toLowerCase(); if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || !password || password.length < 8) return res.status(400).json({ error: 'Valid email and 8+ character password required' }); const otp = String(crypto.randomInt(100000, 1000000)); const hash = bcrypt.hashSync(password, 10), code = bcrypt.hashSync(otp, 8), expires = new Date(Date.now() + 600000); if (pool) { const exists = await query('select 1 from users where email=$1', [normalized]); if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' }); await query('insert into users (id,name,email,password,role,favorites,verified,verification_code,verification_expires) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [Date.now(), String(name).slice(0, 80), normalized, hash, 'user', [], false, code, expires]); } else { const data = localLoad(); if (data.users.some(u => u.email === normalized)) return res.status(409).json({ error: 'Email already registered' }); data.users.push({ id: Date.now(), name: String(name).slice(0, 80), email: normalized, password: hash, role: 'user', favorites: [], verified: false, verificationCode: code, verificationExpires: expires.getTime() }); localSave(data); } await sendOtp(normalized, otp); res.json({ message: 'Verification OTP sent. Check your email.', email: normalized }); });
app.post('/api/auth/verify', async (req, res) => { const email = String(req.body.email || '').toLowerCase(), otp = String(req.body.otp || ''); if (pool) { const result = await query('select * from users where email=$1', [email]), user = result.rows[0]; if (!user || user.verified || !user.verification_expires || Date.now() > new Date(user.verification_expires).getTime() || !bcrypt.compareSync(otp, user.verification_code)) return res.status(400).json({ error: 'Invalid or expired OTP' }); await query('update users set verified=true, verification_code=null, verification_expires=null where id=$1', [user.id]); } else { const data = localLoad(), user = data.users.find(u => u.email === email); if (!user || user.verified || Date.now() > user.verificationExpires || !bcrypt.compareSync(otp, user.verificationCode)) return res.status(400).json({ error: 'Invalid or expired OTP' }); user.verified = true; delete user.verificationCode; delete user.verificationExpires; localSave(data); } res.json({ message: 'Email verified. You can now login.' }); });
app.post('/api/auth/login', async (req, res) => { const email = String(req.body.email || '').toLowerCase(); let user; if (pool) user = (await query('select * from users where email=$1', [email])).rows[0]; else user = localLoad().users.find(u => u.email === email); if (!user || !user.verified || !bcrypt.compareSync(req.body.password || '', user.password)) return res.status(401).json({ error: !user || user.verified ? 'Invalid email or password' : 'Verify your email before logging in' }); res.json({ token: jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET), user: { id: user.id, name: user.name, email: user.email, role: user.role } }); });
app.get('/api/me', auth, async (req, res) => { let user; if (pool) user = (await query('select id,name,email,role,favorites from users where id=$1', [req.user.id])).rows[0]; else user = localLoad().users.find(u => u.id === req.user.id); if (!user) return res.sendStatus(404); res.json({ ...user, favorites: user.favorites || [] }); });
app.get('/api/matches', async (req, res) => { if (pool) return res.json((await query('select * from matches order by id')).rows); const data = localLoad(), search = String(req.query.search || '').toLowerCase(); res.json(data.matches.filter(m => !search || JSON.stringify(m).toLowerCase().includes(search))); });
app.get('/api/matches/:id', async (req, res) => { const m = pool ? (await query('select * from matches where id=$1', [req.params.id])).rows[0] : localLoad().matches.find(x => x.id == req.params.id); m ? res.json(m) : res.status(404).json({ error: 'Match not found' }); });
app.get('/api/news', async (req, res) => res.json(pool ? (await query('select * from news order by id')).rows : localLoad().news));
app.get('/api/rankings', async (req, res) => res.json(pool ? (await query('select * from rankings order by rank')).rows : localLoad().rankings));
app.get('/api/poll', async (req, res) => { if (pool) { const q = await query("select value from app_settings where key='poll_question'"), options = await query('select label,votes from poll_options order by label'); return res.json({ question: q.rows[0]?.value || 'Who wins?', options: options.rows }); } res.json(localLoad().poll); });
app.post('/api/poll', auth, async (req, res) => { if (pool) { const updated = await query('update poll_options set votes=votes+1 where label=$1 returning label,votes', [req.body.option]); if (!updated.rowCount) return res.status(400).json({ error: 'Invalid option' }); const q = await query("select value from app_settings where key='poll_question'"); return res.json({ question: q.rows[0]?.value || 'Who wins?', options: (await query('select label,votes from poll_options')).rows }); } const data = localLoad(), option = data.poll.options.find(x => x.label === req.body.option); if (!option) return res.status(400).json({ error: 'Invalid option' }); option.votes++; localSave(data); res.json(data.poll); });
app.get('/api/comments/:matchId', async (req, res) => res.json(pool ? (await query('select id,match_id as "matchId",user_name as "user",text,created_at as time from comments where match_id=$1 order by created_at', [req.params.matchId])).rows : localLoad().comments.filter(c => c.matchId == req.params.matchId)));
app.post('/api/comments/:matchId', auth, async (req, res) => { const text = String(req.body.text || '').slice(0, 500); if (!text) return res.status(400).json({ error: 'Comment required' }); const id = Date.now(); if (pool) return res.json((await query('insert into comments (id,match_id,user_id,user_name,text) values ($1,$2,$3,$4,$5) returning id,match_id as "matchId",user_name as "user",text,created_at as time', [id, req.params.matchId, req.user.id, req.user.name, text])).rows[0]); const data = localLoad(), comment = { id, matchId: Number(req.params.matchId), user: req.user.name, text, time: new Date().toISOString() }; data.comments.push(comment); localSave(data); res.json(comment); });
app.post('/api/favorites/:id', auth, async (req, res) => { if (pool) { const user = (await query('select favorites from users where id=$1', [req.user.id])).rows[0]; if (!user) return res.sendStatus(404); const id = Number(req.params.id), favorites = (user.favorites || []).map(Number); const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]; await query('update users set favorites=$1 where id=$2', [next, req.user.id]); return res.json({ favorites: next }); } const data = localLoad(), user = data.users.find(u => u.id === req.user.id), id = Number(req.params.id); user.favorites = user.favorites.includes(id) ? user.favorites.filter(x => x !== id) : [...user.favorites, id]; localSave(data); res.json({ favorites: user.favorites }); });
app.get('/api/admin/stats', auth, admin, async (req, res) => { if (pool) { const counts = await Promise.all(['users', 'matches', 'comments'].map(t => query(`select count(*)::int as count from ${t}`))); return res.json({ users: counts[0].rows[0].count, matches: counts[1].rows[0].count, comments: counts[2].rows[0].count }); } const data = localLoad(); res.json({ users: data.users.length, matches: data.matches.length, comments: data.comments.length }); });
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const server = app.listen(PORT, () => console.log(`CricLive running at http://localhost:${PORT}`));
server.on('error', error => { if (error.code === 'EADDRINUSE') { console.error(`Port ${PORT} is already in use.`); process.exitCode = 1; } else { console.error(error); process.exitCode = 1; } });
