const fs=require('fs'),{Pool}=require('pg');
for(const line of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
Promise.all(['users','matches','news','rankings','comments','poll_options','app_settings'].map(async t=>`${t}:${(await p.query(`select count(*)::int as count from ${t}`)).rows[0].count}`)).then(x=>console.log(x.join('\n'))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.end());
