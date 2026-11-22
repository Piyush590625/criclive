const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['\"]|['\"]$/g, '');
  }
}

const file = path.join(__dirname, '..', 'db.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL before running migration.');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of data.users || []) await client.query(`insert into users (id,name,email,password,role,favorites,verified,verification_code,verification_expires) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do update set name=excluded.name,email=excluded.email,password=excluded.password,role=excluded.role,favorites=excluded.favorites,verified=excluded.verified,verification_code=excluded.verification_code,verification_expires=excluded.verification_expires`, [u.id,u.name,u.email,u.password,u.role,u.favorites||[],u.verified||false,u.verificationCode||null,u.verificationExpires?new Date(u.verificationExpires):null]);
    for (const m of data.matches || []) await client.query(`insert into matches (id,series,title,short,status,venue,date,format,team1,team2,score1,score2,overs,result,featured) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (id) do update set series=excluded.series,title=excluded.title,short=excluded.short,status=excluded.status,venue=excluded.venue,date=excluded.date,format=excluded.format,team1=excluded.team1,team2=excluded.team2,score1=excluded.score1,score2=excluded.score2,overs=excluded.overs,result=excluded.result,featured=excluded.featured`, [m.id,m.series||'',m.title||'',m.short||'',m.status||'UPCOMING',m.venue||'',m.date||'',m.format||'',m.team1||'',m.team2||'',m.score1||'',m.score2||'',m.overs||'',m.result||'',m.featured||false]);
    for (const n of data.news || []) await client.query(`insert into news (id,tag,title,body,time,hero) values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set tag=excluded.tag,title=excluded.title,body=excluded.body,time=excluded.time,hero=excluded.hero`, [n.id,n.tag||'',n.title||'',n.body||'',n.time||'',n.hero||false]);
    for (const r of data.rankings || []) await client.query(`insert into rankings (rank,name,team,rating,kind) values ($1,$2,$3,$4,$5) on conflict (rank) do update set name=excluded.name,team=excluded.team,rating=excluded.rating,kind=excluded.kind`, [r.rank,r.name,r.team||'',r.rating||0,r.kind||'']);
    for (const c of data.comments || []) await client.query(`insert into comments (id,match_id,user_name,text,created_at) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [c.id,c.matchId,c.user||'User',c.text,new Date(c.time||Date.now())]);
    for (const o of data.poll?.options || []) await client.query(`insert into poll_options (label,votes) values ($1,$2) on conflict (label) do update set votes=excluded.votes`, [o.label,o.votes||0]);
    await client.query(`insert into app_settings (key,value) values ('poll_question',$1) on conflict (key) do update set value=excluded.value`, [JSON.stringify(data.poll?.question||'Who wins?')]);
    await client.query('COMMIT'); console.log('Supabase migration completed.');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
})().catch(error => { console.error(error.message); process.exit(1); });
