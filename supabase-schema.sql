-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- It sets up the two tables the app needs.

create extension if not exists "pgcrypto";

-- Exercise library: the list of exercises you can pick from when logging a session.
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#3B7DD8', -- plate color, hex
  created_at timestamptz not null default now()
);

-- Seed a starter library. Feel free to edit/add more later from the app.
insert into exercises (name, color) values
  ('Push-ups', '#C6482E'),
  ('Pull-ups', '#3B7DD8'),
  ('Squats', '#E3B23C'),
  ('Lunges', '#4C9A5B'),
  ('Sit-ups', '#C6482E'),
  ('Plank (seconds)', '#3B7DD8')
on conflict (name) do nothing;

-- Workout sessions: one row per exercise logged on a given day.
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  exercise_id uuid not null references exercises(id) on delete cascade,
  reps_per_set integer[] not null, -- e.g. {12,12,10} = 3 sets
  notes text,
  created_at timestamptz not null default now()
);

-- This app has no login (per your choice), so it uses the public anon key
-- with row-level security OFF for simplicity. Only share your Supabase
-- anon key/URL with people you trust, since anyone with them can write data.
alter table exercises enable row level security;
alter table workouts enable row level security;

create policy "public read exercises" on exercises for select using (true);
create policy "public write exercises" on exercises for insert with check (true);
create policy "public read workouts" on workouts for select using (true);
create policy "public write workouts" on workouts for insert with check (true);
create policy "public update workouts" on workouts for update using (true);
create policy "public delete workouts" on workouts for delete using (true);
