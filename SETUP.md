# Van Shop Verification — Setup Guide

## What this app does
- 5 vans, each with editable shop entries (shop code + customer name).
- Each shop: notes, stock status, balance amount, verified date, and up to 8 photos.
- All data lives in a real database (Postgres on Supabase) and photos live in Supabase Storage —
  nothing is stored only in memory, so it survives restarts, redeploys, and multiple people using it at once.
- A backup Excel file (`shops_backup.xlsx`) is kept in sync automatically after every change, and you
  can also click "Backup now" in the app to download it instantly.

## Step 1 — Create your free Supabase project (database + photo storage)
1. Go to supabase.com and sign up (free, no card).
2. Create a new project. Pick any name/region, set a database password (save it somewhere).
3. Wait ~2 min for it to provision.
4. Go to **Project Settings → Database → Connection string → URI**. Copy it — this is your `DATABASE_URL`.
   Replace `[YOUR-PASSWORD]` in that string with the password you set.
5. Go to **Project Settings → API**. Copy the **Project URL** (`SUPABASE_URL`) and the
   **service_role key** (`SUPABASE_SERVICE_KEY`) — NOT the anon key, the service_role one (keep it secret).

## Step 2 — Create your free Render account (hosts the app / gives you the public link)
1. Go to render.com and sign up (free, no card) — you can sign up with GitHub.
2. Put this project's code in a GitHub repo (private is fine). If you don't already have one,
   I can help you push this folder to a new GitHub repo.
3. In Render: **New → Web Service** → connect your GitHub repo.
4. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
5. Under **Environment**, add these variables (values from Step 1):
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `APP_ACCESS_CODE` — pick any code/phrase (e.g. `van-2026-secure`). Only people who have both the
     link *and* this code can get in. Share it with your 5 field guys separately from the link
     (e.g. verbally or a different message), so someone who intercepts one doesn't get the other.
6. Click **Create Web Service**. First deploy takes a few minutes.
7. Render gives you a public URL like `https://your-app.onrender.com` — that's the link you send
   to your 5 field guys.

Note: Render's free tier sleeps after ~15 min of no traffic and takes ~30s to wake up on the next
visit. Your data is never lost either way — it all lives in Supabase, not on Render's disk.

## Step 3 — Test it
1. Open the link, pick a van, click "Bulk Create Empty Slots" and enter 90 to generate SHOP-001..090
   placeholder shops (or add them one by one with real codes/customer names).
2. Open a shop, fill the form, click "Save Shop Data" — you should see "Saved ✓".
3. Upload a couple of test photos, refresh the page, confirm they're still there.
4. Click "Backup now" in the top bar — it downloads an up-to-date `shops_backup.xlsx`.

## Local testing (optional, before deploying)
1. Copy `.env.example` to `.env` and fill in the 3 values from Step 1.
2. `npm install`
3. `npm start`
4. Open `http://localhost:3000`

## About security & confidentiality
- The site is gated by a shared access code (`APP_ACCESS_CODE`) — visiting the link without it just
  shows a login screen. Once someone enters the correct code, their browser is trusted for 30 days.
- Photos are stored in a **private** Supabase bucket, not a public one. The app hands out short-lived
  signed links (valid ~1 hour) only to people already past the access-code gate — a stranger who
  somehow got a photo URL couldn't reuse it later.
- The backup Excel file lives in a separate private bucket, downloadable only via the app's
  "Backup now" button (which also requires being logged in).
- Nothing is logged to third parties; all data lives in your own Supabase project.
- If someone leaves the team or you suspect the code leaked, just change `APP_ACCESS_CODE` in Render's
  environment variables and redeploy — old cookies stop working immediately.
