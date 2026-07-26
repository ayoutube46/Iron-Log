-- ============================================================
-- Iron Log v2 — Multi-user schema with login
-- Safe to run even if you already ran the original v1 schema:
-- it upgrades your existing tables in place rather than
-- recreating them.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---- Profiles: maps a chosen username to a Supabase Auth account ----
-- Supabase Auth itself only understands email+password. To support plain
-- usernames, the app signs people up with a synthetic email built from their
-- username (e.g. "alex" -> "alex@users.ironlog.local") and stores the real
-- username here, with a UNIQUE constraint so two people can't claim the same one.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "anyone can check usernames" on profiles;
create policy "anyone can check usernames" on profiles for select using (true);

drop policy if exists "users create own profile" on profiles;
create policy "users create own profile" on profiles for insert with check (auth.uid() = id);

-- ---- Exercises: add ownership + archive support ----
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#3B7DD8',
  created_at timestamptz not null default now()
);

alter table exercises add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table exercises add column if not exists archived boolean not null default false;

-- ---- Workouts: add ownership ----
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  exercise_id uuid not null references exercises(id) on delete cascade,
  reps_per_set integer[] not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table workouts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table workouts add column if not exists set_durations integer[]; -- seconds per set, same index order as reps_per_set. Null entries allowed for sets logged before this feature existed.

-- ---- Replace v1's "public" policies with per-user policies ----
alter table exercises enable row level security;
alter table workouts enable row level security;

drop policy if exists "public read exercises" on exercises;
drop policy if exists "public write exercises" on exercises;
drop policy if exists "public read workouts" on workouts;
drop policy if exists "public write workouts" on workouts;
drop policy if exists "public update workouts" on workouts;
drop policy if exists "public delete workouts" on workouts;

drop policy if exists "own exercises select" on exercises;
drop policy if exists "own exercises insert" on exercises;
drop policy if exists "own exercises update" on exercises;
drop policy if exists "own exercises delete" on exercises;
create policy "own exercises select" on exercises for select using (auth.uid() = user_id);
create policy "own exercises insert" on exercises for insert with check (auth.uid() = user_id);
create policy "own exercises update" on exercises for update using (auth.uid() = user_id);
create policy "own exercises delete" on exercises for delete using (auth.uid() = user_id);

drop policy if exists "own workouts select" on workouts;
drop policy if exists "own workouts insert" on workouts;
drop policy if exists "own workouts update" on workouts;
drop policy if exists "own workouts delete" on workouts;
create policy "own workouts select" on workouts for select using (auth.uid() = user_id);
create policy "own workouts insert" on workouts for insert with check (auth.uid() = user_id);
create policy "own workouts update" on workouts for update using (auth.uid() = user_id);
create policy "own workouts delete" on workouts for delete using (auth.uid() = user_id);

-- ============================================================
-- MIGRATING EXISTING (pre-login) DATA
-- If you were already using the single-user version, your old rows have no
-- user_id and will be invisible once RLS is active. After creating your
-- account in the app, find your user id in Supabase under
-- Authentication > Users, then run (uncommented, with your real id):
--
-- update exercises set user_id = 'YOUR_USER_ID' where user_id is null;
-- update workouts set user_id = 'YOUR_USER_ID' where user_id is null;
-- ============================================================
