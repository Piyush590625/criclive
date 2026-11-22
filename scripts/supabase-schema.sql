-- Run this in Supabase Dashboard -> SQL Editor.
create table if not exists users (
  id bigint primary key,
  name text not null,
  email text unique not null,
  password text not null,
  role text not null default 'user',
  favorites bigint[] not null default '{}',
  verified boolean not null default false,
  verification_code text,
  verification_expires timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists matches (
  id bigint primary key,
  series text not null default '', title text not null, short text not null default '',
  status text not null default 'UPCOMING', venue text not null default '', date text not null default '',
  format text not null default '', team1 text not null default '', team2 text not null default '',
  score1 text not null default '', score2 text not null default '', overs text not null default '',
  result text not null default '', featured boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists news (
  id bigint primary key, tag text not null default '', title text not null, body text not null default '',
  time text not null default '', hero boolean not null default false
);
create table if not exists rankings (
  rank integer primary key, name text not null, team text not null default '', rating integer not null default 0, kind text not null default ''
);
create table if not exists comments (
  id bigint primary key, match_id bigint not null references matches(id) on delete cascade,
  user_id bigint references users(id) on delete set null, user_name text not null, text text not null,
  created_at timestamptz not null default now()
);
create table if not exists poll_options (
  label text primary key, votes integer not null default 0
);
create table if not exists app_settings (
  key text primary key, value jsonb not null
);
create index if not exists comments_match_id_idx on comments(match_id);

-- Keep the application backend-only. Do not expose the DATABASE_URL or service role key in frontend code.
