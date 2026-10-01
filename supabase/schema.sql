-- Notvikens IK – Träningsliga
-- Kör hela filen i Supabase: SQL Editor → New query → klistra in → Run.
-- Går att köra flera gånger utan att något förstörs.

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists training_sessions (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists results (
  id                  uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references training_sessions(id) on delete cascade,
  player_id           uuid not null references players(id) on delete cascade,
  game_type           text not null check (game_type in ('small', 'medium', 'large')),
  result              text not null check (result in ('win', 'loss')),
  -- Alla rader i samma omgång får samma created_at (sätts av appen)
  created_at          timestamptz not null default now()
);

create index if not exists results_player_idx  on results (player_id);
create index if not exists results_session_idx on results (training_session_id);

-- Ingen inloggning/roller: appen använder anon-nyckeln.
-- Alla med länken kan läsa och registrera, men inget kan raderas från appen.
grant select, insert, update on players           to anon;
grant select, insert         on training_sessions to anon;
grant select, insert         on results           to anon;

alter table players           enable row level security;
alter table training_sessions enable row level security;
alter table results           enable row level security;

drop policy if exists "public read"   on players;
drop policy if exists "public insert" on players;
drop policy if exists "public update" on players;
drop policy if exists "public read"   on training_sessions;
drop policy if exists "public insert" on training_sessions;
drop policy if exists "public read"   on results;
drop policy if exists "public insert" on results;

create policy "public read"   on players           for select to anon using (true);
create policy "public insert" on players           for insert to anon with check (true);
create policy "public update" on players           for update to anon using (true) with check (true);
create policy "public read"   on training_sessions for select to anon using (true);
create policy "public insert" on training_sessions for insert to anon with check (true);
create policy "public read"   on results           for select to anon using (true);
create policy "public insert" on results           for insert to anon with check (true);
