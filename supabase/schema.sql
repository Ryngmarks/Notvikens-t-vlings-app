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

-- ============================================================
-- Behörighet: bara INLOGGADE användare kommer åt datan.
-- Utan inloggning (bara publishable/anon-nyckeln) går ingenting
-- att läsa eller skriva – oavsett vilken adress man går till.
-- Inget kan raderas, och sparade resultat kan inte ändras, via appen.
-- ============================================================

-- Ta bort tidigare öppna rättigheter (från den första versionen av schemat)
revoke all on players, training_sessions, results from anon;

grant select, insert, update on players           to authenticated;
grant select, insert         on training_sessions to authenticated;
grant select, insert         on results           to authenticated;

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

drop policy if exists "team read"   on players;
drop policy if exists "team insert" on players;
drop policy if exists "team update" on players;
drop policy if exists "team read"   on training_sessions;
drop policy if exists "team insert" on training_sessions;
drop policy if exists "team read"   on results;
drop policy if exists "team insert" on results;

create policy "team read"   on players           for select to authenticated using (true);
create policy "team insert" on players           for insert to authenticated with check (true);
create policy "team update" on players           for update to authenticated using (true) with check (true);
create policy "team read"   on training_sessions for select to authenticated using (true);
create policy "team insert" on training_sessions for insert to authenticated with check (true);
create policy "team read"   on results           for select to authenticated using (true);
create policy "team insert" on results           for insert to authenticated with check (true);

-- ============================================================
-- TAKTIKTAVLA
-- Bara e-postadresser i tactics_access kommer åt taktiktavlan.
-- Lägg till fler så här (i SQL Editor):
--   insert into tactics_access (email) values ('namn@exempel.se');
-- Ta bort:
--   delete from tactics_access where email = 'namn@exempel.se';
-- ============================================================

create table if not exists tactics_access (
  email      text primary key,
  created_at timestamptz not null default now()
);

insert into tactics_access (email) values ('johan@ryngmarks.com')
  on conflict (email) do nothing;

-- Har den inloggade användaren tillgång? (används av appen och av policies nedan)
create or replace function public.has_tactics_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tactics_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.has_tactics_access() from public, anon;
grant execute on function public.has_tactics_access() to authenticated;

-- Listan går inte att läsa eller ändra från appen – bara här i SQL Editor
alter table tactics_access enable row level security;
revoke all on tactics_access from anon, authenticated;

-- En taktik = ett visuellt dokument, sparat som JSON
create table if not exists tactics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Namnlös taktik',
  scenario_data jsonb not null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tactics_updated_idx on tactics (updated_at desc);

create or replace function public.tactics_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tactics_touch on tactics;
create trigger tactics_touch before update on tactics
  for each row execute function public.tactics_touch();

revoke all on tactics from anon;
grant select, insert, update, delete on tactics to authenticated;
alter table tactics enable row level security;

drop policy if exists "tactics read"   on tactics;
drop policy if exists "tactics insert" on tactics;
drop policy if exists "tactics update" on tactics;
drop policy if exists "tactics delete" on tactics;

create policy "tactics read"   on tactics for select to authenticated using (public.has_tactics_access());
create policy "tactics insert" on tactics for insert to authenticated with check (public.has_tactics_access());
create policy "tactics update" on tactics for update to authenticated using (public.has_tactics_access()) with check (public.has_tactics_access());
create policy "tactics delete" on tactics for delete to authenticated using (public.has_tactics_access());
