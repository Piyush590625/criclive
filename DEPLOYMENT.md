# CricLive

## Local development

1. Copy `.env.example` to `.env` and fill local secrets.
2. Run `npm install`.
3. Run `npm start` and open `http://localhost:3000`.

Without `DATABASE_URL`, the app keeps using `db.json` for local development. Production must set `DATABASE_URL` and use the Supabase schema/migration flow below.

## Supabase + Render free-tier deployment

1. Create a Supabase project. In **Project Settings -> Database**, copy the direct connection string. Replace `[YOUR-PASSWORD]` locally; never commit it.
2. Open Supabase **SQL Editor**, paste and run `scripts/supabase-schema.sql`.
3. Export the connection string in a local terminal:
   - PowerShell: `$env:DATABASE_URL='postgresql://...'`
4. Run `npm run migrate` once. Verify rows in Supabase Table Editor.
5. Create a Render **Web Service** from this project. Build command: `npm install`. Start command: `npm start`. Choose the Free instance.
6. Add Render environment variables: `DATABASE_URL`, `JWT_SECRET` (new random 32+ character value), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), `RAPIDAPI_KEY`, `RAPIDAPI_HOST=cricbuzz-cricket.p.rapidapi.com`, `CRICKETDATA_API_KEY=56368392-2fd4-4f78-baa5-9989239dff4e`, `CRICKETDATA_BASE_URL=https://api.cricketdata.org`, and optional Gmail variables. The CricketData key is only read by the backend and is cached for 15 minutes; RapidAPI results are cached for 60 seconds.
7. Do not upload `.env`, `db.json`, or API keys to GitHub. Add them to `.gitignore`.
8. Deploy. Check `https://YOUR-SERVICE.onrender.com/api/health`, then open the service URL.

Render free services sleep after inactivity. The first request after sleep can take a short time. Supabase free projects may pause under inactivity or quota limits; review the dashboard before production use.
