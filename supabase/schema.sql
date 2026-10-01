-- Notvikens IK – Träningsliga
-- Kör i Supabase SQL Editor när demon är godkänd.

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
alter table players           enable row level security;
alter table training_sessions enable row level security;
alter table results           enable row level security;

create policy "public read"   on players           for select using (true);
create policy "public insert" on players           for insert with check (true);
create policy "public update" on players           for update using (true);
create policy "public read"   on training_sessions for select using (true);
create policy "public insert" on training_sessions for insert with check (true);
create policy "public read"   on results           for select using (true);
create policy "public insert" on results           for insert with check (true);
