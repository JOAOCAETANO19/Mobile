-- Rhythm Dash — schema do banco no Supabase
-- Cole este arquivo INTEIRO no SQL Editor do seu projeto e clique em "Run".
-- Passo a passo completo no README (seção "Banco de dados — Supabase").

-- 1) Tabela de recordes por jogador (uma linha por usuário + música)
create table if not exists public.records (
  user_id uuid references auth.users (id) on delete cascade not null,
  track_key text not null,
  best_score integer not null default 0,
  best_combo integer not null default 0,
  best_progress_pct integer not null default 0,
  plays integer not null default 0,
  finishes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_key)
);

-- 2) Só o dono lê/escreve os próprios recordes (Row-Level Security)
alter table public.records enable row level security;

drop policy if exists "user-select-own" on public.records;
drop policy if exists "user-insert-own" on public.records;
drop policy if exists "user-update-own" on public.records;

create policy "user-select-own" on public.records
  for select using (auth.uid() = user_id);
create policy "user-insert-own" on public.records
  for insert with check (auth.uid() = user_id);
create policy "user-update-own" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Confirmação de email: para a demo da escola, DESATIVE em
--    Authentication → Providers → Email → "Confirm email"
--    (senão o cadastro trava até o jogador abrir o email de confirmação).
