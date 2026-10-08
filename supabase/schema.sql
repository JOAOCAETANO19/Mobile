-- Rhythm Dash: execute este arquivo no SQL Editor do projeto Supabase.
-- O cliente público só acessa linhas da própria conta (RLS); não use service_role no app.

create table if not exists public.player_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id text not null check (char_length(track_id) between 1 and 96),
  track_title text not null default '' check (char_length(track_title) <= 160),
  track_artist text not null default '' check (char_length(track_artist) <= 120),
  score bigint not null default 0 check (score >= 0),
  best_combo integer not null default 0 check (best_combo >= 0),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create index if not exists player_records_user_score_idx
  on public.player_records (user_id, score desc, updated_at desc);

alter table public.player_records enable row level security;

-- Remove qualquer policy anterior desta tabela (policies permissivas se combinam por OR).
-- Isso também torna seguro reaplicar o schema após uma configuração incompleta.
do $block$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'player_records'
  loop
    execute pg_catalog.format('drop policy %I on public.player_records', existing_policy.policyname);
  end loop;
end;
$block$;

create policy "Players can read their own records"
  on public.player_records for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Players can insert their own records"
  on public.player_records for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Players can update their own records"
  on public.player_records for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
revoke all on table public.player_records from public, anon, authenticated;
grant select, insert, update on table public.player_records to authenticated;

-- RPC atômica: um resultado atrasado nunca substitui uma pontuação/combo maior.
-- SECURITY INVOKER mantém as permissões e políticas RLS do usuário conectado.
create or replace function public.submit_player_record(
  p_track_id text,
  p_track_title text,
  p_track_artist text,
  p_score bigint,
  p_best_combo integer,
  p_completed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_track_id text := pg_catalog.left(pg_catalog.btrim(coalesce(p_track_id, '')), 96);
  v_record public.player_records;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_track_id = '' then
    raise exception 'track_id is required' using errcode = '22023';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'score must be zero or greater' using errcode = '22023';
  end if;
  if p_best_combo is null or p_best_combo < 0 then
    raise exception 'best_combo must be zero or greater' using errcode = '22023';
  end if;

  insert into public.player_records as current_record (
    user_id, track_id, track_title, track_artist, score, best_combo, completed
  ) values (
    v_user_id,
    v_track_id,
    pg_catalog.left(coalesce(p_track_title, ''), 160),
    pg_catalog.left(coalesce(p_track_artist, ''), 120),
    p_score,
    p_best_combo,
    coalesce(p_completed, false)
  )
  on conflict (user_id, track_id) do update set
    track_title = case when excluded.track_title <> '' then excluded.track_title else current_record.track_title end,
    track_artist = case when excluded.track_artist <> '' then excluded.track_artist else current_record.track_artist end,
    score = greatest(current_record.score, excluded.score),
    best_combo = greatest(current_record.best_combo, excluded.best_combo),
    completed = current_record.completed or excluded.completed,
    updated_at = pg_catalog.now()
  returning * into v_record;

  return pg_catalog.to_jsonb(v_record);
end;
$function$;

revoke all on function public.submit_player_record(text, text, text, bigint, integer, boolean) from public, anon;
grant execute on function public.submit_player_record(text, text, text, bigint, integer, boolean) to authenticated;
