# Iron Log — Exercise Tracker

A small static site for logging daily exercises (sets × reps), viewing your history,
and tracking personal bests and progress over time. Built for free hosting on GitHub
Pages with a free Supabase database for storage.

No login is required — anyone with the URL and your Supabase keys could write to your
data, so treat the deployed URL as semi-private (don't post it publicly) rather than
locking it down with auth.

## 1. Set up the database (Supabase, free)

1. Go to [supabase.com](https://supabase.com) and create a free account, then a new project.
   Pick any name/region/password (you won't need the password directly).
2. Wait ~2 minutes for the project to finish provisioning.
3. Open the **SQL Editor** (left sidebar) → **New query**.
4. Copy the entire contents of `supabase-schema.sql` from this folder, paste it in, and
   click **Run**. This creates two tables (`exercises`, `workouts`) and seeds a starter
   list of exercises.
5. Go to **Settings → API**. You'll need two values from this page:
   - **Project URL**
   - **anon public** key (NOT the `service_role` key — never expose that one)

## 2. Connect the site to your database

1. Open `config.js` in this folder.
2. Replace the placeholder values:
   ```js
   window.SUPABASE_CONFIG = {
     url: "https://xxxxxxxx.supabase.co",
     anonKey: "eyJ...",
   };
   ```
3. Save.

## 3. Run it locally (optional, to test before deploying)

Any static file server works, e.g. from this folder:
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000`.

## 4. Deploy to GitHub Pages (free)

1. Create a new GitHub repository (public or private both work with GitHub Pages on
   a paid plan; public repos get Pages for free).
2. Push these files to the repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", branch
   `main`, folder `/ (root)`. Save.
5. After a minute or two, your site will be live at
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

**Note:** since `config.js` contains your Supabase anon key, keeping the repo
**private** is a good idea if you'd rather not have it publicly visible on GitHub
(GitHub Pages can serve from private repos with GitHub Pro/Team/Enterprise; otherwise
make the repo public and rely on the URL simply not being shared/indexed).

## 5. Keeping the free database awake

Supabase pauses free projects after 7 days with no activity. If you use the app at
least once a week, this is a non-issue. If you might go longer without logging a
workout, add a free scheduled GitHub Action to ping your project weekly:

Create `.github/workflows/keep-alive.yml`:
```yaml
name: Keep Supabase Awake
on:
  schedule:
    - cron: "0 12 * * 1" # every Monday at 12:00 UTC
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase
        run: curl -s "${{ secrets.SUPABASE_URL }}/rest/v1/exercises?select=id&limit=1" -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}"
```
Then add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as repo secrets under
**Settings → Secrets and variables → Actions**.

## How the app works

- **Log tab** — pick an exercise (or add a new one), enter reps for each set, and save.
  Saving multiple times for the same exercise on the same day appends more sets to that
  day's entry rather than creating duplicates.
- **History tab** — a 12-week activity heatmap (darker green = more sets that day) plus
  an expandable list of past sessions.
- **Analytics tab** — personal-best cards (best single set, best session total) per
  exercise, plus a line chart of total reps per session for whichever exercise you
  select.

## Extending it later

Some ideas if you want to keep building on this:
- Add optional weight tracking per set (the schema and UI currently assume bodyweight/reps only)
- Add a simple PIN/password gate using Supabase Auth if you want real write protection
- Add a CSV export button (a `SELECT * FROM workouts` export via the Supabase dashboard works today with no code)
- Track body measurements or bodyweight alongside workouts
