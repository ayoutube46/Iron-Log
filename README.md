# Iron Log — Exercise Tracker

A static site for logging daily exercises (sets × reps), viewing your history, and
tracking personal bests and progress over time. Multiple people can each create their
own account — everyone only ever sees their own data. Built for free hosting on GitHub
Pages with a free Supabase database for storage and login.

## 1. Set up the database (Supabase, free)

1. Go to [supabase.com](https://supabase.com) and create a free account, then a new project.
   Pick any name/region/password (you won't need the password directly).
2. Wait ~2 minutes for the project to finish provisioning.
3. Open the **SQL Editor** (left sidebar) → **New query**.
4. Copy the entire contents of `supabase-schema.sql` from this folder, paste it in, and
   click **Run**. This creates the `profiles`, `exercises`, and `workouts` tables with
   per-user permissions. (If you previously ran the older single-user version of this
   schema, it's safe to run this again — it upgrades your existing tables in place. See
   the migration note at the bottom of the SQL file if you have old data to carry over.)
5. Go to **Settings → API**. You'll need two values from this page:
   - **Project URL** — near the top of the page, under the "Project URL" heading (it
     looks like `https://xxxxxxxx.supabase.co`)
   - **anon public** key — further down under "Project API keys", labeled `anon`
     `public` (NOT the `service_role` key — never expose that one)
6. Turn off email confirmation so accounts work instantly with just a username and
   password (no real email is ever sent or needed): go to **Authentication → Providers**,
   click **Email**, and toggle **Confirm email** off. Save.

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
2. Add these files to the repo. There are two ways to do this — pick whichever feels
   easier:

   **Option A: upload through the GitHub website (no command line needed)**
   1. Open your new repo's page on github.com.
   2. Click **Add file → Upload files**.
   3. Drag in all the files from this folder (`index.html`, `style.css`, `app.js`,
      `config.js`, `supabase-schema.sql`, `README.md`).
   4. Scroll down and click **Commit changes**.

   **Option B: use git from a terminal**, if you're comfortable with the command line
   (on Mac, open the **Terminal** app; on Windows, use **Git Bash** or the **Terminal**
   app — you'll need [git installed](https://git-scm.com/downloads) first). Navigate
   into this folder (e.g. `cd path/to/exercise-tracker`), then run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
   Replace `YOUR_USERNAME/YOUR_REPO` with your actual GitHub username and repo name —
   you can copy the exact URL from the "…or push an existing repository" section GitHub
   shows you right after creating the repo.
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", branch
   `main`, folder `/ (root)`. Save.
5. After a minute or two, a green banner near the top of that same Pages settings page
   will show your live URL: `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

**Note:** since `config.js` contains your Supabase anon key, keeping the repo
**private** is a good idea if you'd rather not have it publicly visible on GitHub
(GitHub Pages can serve from private repos with GitHub Pro/Team/Enterprise; otherwise
make the repo public — this is fine since the anon key alone can't do anything without
a valid login, thanks to the per-user database permissions set up in step 1).

## 5. Keeping the free database awake

Supabase pauses free projects after 7 days with no activity. If the app gets used at
least once a week, this is a non-issue. If it might go longer without anyone logging a
workout, add a free scheduled GitHub Action to ping the project weekly:

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

- **Accounts** — anyone can create an account with just a username and password (no
  email needed). Usernames are enforced unique — signup fails with a clear message if
  one's already taken. Everyone only ever sees and edits their own exercises and
  workouts; Supabase's row-level security enforces this at the database level, not just
  in the app's UI.
- **Log tab** — pick an exercise (or add a new one), enter reps for each set, and save.
  Saving multiple times for the same exercise on the same day appends more sets to that
  day's entry rather than creating duplicates. Beating a previous best triggers a small
  celebration animation and a "PR!" badge.
- **Manage exercises** (gear icon on the Log tab) — rename an exercise, cycle its plate
  color, **archive** it (hides it from the picker but keeps all its history), or
  **permanently delete** it. Deleting warns you first and tells you exactly how many
  logged sessions will be lost, since deleting an exercise removes its history for good.
- **History tab** — a 12-week activity heatmap (darker green = more sets that day) plus
  an expandable list of past sessions.
- **Analytics tab** — headline stats (total sessions, sets, reps, and current day
  streak), personal-best cards (best single set, best session total) per exercise, a
  stacked weekly-volume chart comparing all exercises, and a progress chart you can
  switch between total reps / best set / number of sets, over the last 30 days, 90 days,
  or all time.

## Extending it later

Some ideas if you want to keep building on this:
- Add optional weight tracking per set (the schema and UI currently assume bodyweight/reps only)
- Add a "forgot password" flow (Supabase supports this, but it requires real email
  delivery, which trades away the no-email-needed simplicity of the current setup)
- Add a CSV export button (a `SELECT * FROM workouts` export via the Supabase dashboard
  works today with no code)
- Track body measurements or bodyweight alongside workouts
