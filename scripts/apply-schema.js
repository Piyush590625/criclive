const fs=require('fs'),path=require('path'),{Pool}=require('pg');
for(const line of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
pool.query(fs.readFileSync(path.join('scripts','supabase-schema.sql'),'utf8')).then(()=>{console.log('Supabase schema applied');return pool.end();}).catch(e=>{console.error(e.message);pool.end();process.exit(1);});
