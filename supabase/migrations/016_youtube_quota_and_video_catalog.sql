-- 016_youtube_quota_and_video_catalog.sql
-- Adds: youtube_daily_usage, skill_video_catalog, discovery_requests,
--       reserve_youtube_units(), enqueue_discovery_request().
-- New tables have RLS enabled. Functions are service_role-only.

-- 1. Quota ledger (Pacific-time day boundaries)
create table if not exists public.youtube_daily_usage (
  usage_date      date not null primary key,
  units_consumed  integer not null default 0,
  search_calls    integer not null default 0,
  list_calls      integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- 2. Skill video catalog (source of truth for Gap Report video cards)
create table if not exists public.skill_video_catalog (
  id               uuid primary key default gen_random_uuid(),
  skill            text not null,
  video_id         text not null,
  rank             integer not null default 0,
  title            text not null,
  channel_name     text not null,
  thumbnail_url    text not null,
  duration_seconds integer,
  view_count       bigint,
  published_at     timestamptz,
  source           text not null default 'youtube_api'
                   check (source in ('youtube_api', 'seed')),
  fetched_at       timestamptz not null default now(),
  unique(skill, video_id)
);
create index if not exists idx_skill_video_catalog_skill_rank
  on public.skill_video_catalog (skill, rank);

-- 3. Discovery request queue (global, one row per skill)
create table if not exists public.discovery_requests (
  skill           text primary key,
  requested_at    timestamptz not null default now(),
  request_count   integer not null default 1,
  last_status     text
);

-- 4. Atomic quota reservation
create or replace function public.reserve_youtube_units(
  p_units     int,
  p_ceiling   int,
  p_call_type text default 'list'  -- 'search' | 'list'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_units is null or p_units <= 0 then
    raise exception 'p_units must be a positive integer, got: %', p_units;
  end if;
  if p_ceiling is null or p_ceiling <= 0 then
    raise exception 'p_ceiling must be a positive integer, got: %', p_ceiling;
  end if;
  if p_call_type is null or p_call_type not in ('search', 'list') then
    raise exception 'p_call_type must be search or list, got: %', p_call_type;
  end if;

  if p_units > p_ceiling then
    return false;
  end if;

  insert into public.youtube_daily_usage
    (usage_date, units_consumed, search_calls, list_calls, updated_at)
  values (
    (now() at time zone 'America/Los_Angeles')::date,
    p_units,
    case when p_call_type = 'search' then 1 else 0 end,
    case when p_call_type = 'list' then 1 else 0 end,
    now()
  )
  on conflict (usage_date) do update set
    units_consumed = youtube_daily_usage.units_consumed + p_units,
    search_calls = youtube_daily_usage.search_calls
                   + case when p_call_type = 'search' then 1 else 0 end,
    list_calls = youtube_daily_usage.list_calls
                 + case when p_call_type = 'list' then 1 else 0 end,
    updated_at = now()
  where youtube_daily_usage.units_consumed + p_units <= p_ceiling;

  return found;
end;
$$;

revoke all on function public.reserve_youtube_units(int, int, text)
  from public, anon, authenticated;
grant execute on function public.reserve_youtube_units(int, int, text)
  to service_role;

-- 5. Atomic discovery request enqueue
create or replace function public.enqueue_discovery_request(p_skill text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_skill is null or trim(p_skill) = '' then
    raise exception 'p_skill must be a non-empty string';
  end if;

  insert into public.discovery_requests
    (skill, requested_at, request_count, last_status)
  values (trim(p_skill), now(), 1, null)
  on conflict (skill) do update set
    request_count = discovery_requests.request_count + 1,
    requested_at  = now();
end;
$$;

revoke all on function public.enqueue_discovery_request(text)
  from public, anon, authenticated;
grant execute on function public.enqueue_discovery_request(text)
  to service_role;

-- 6. RLS
alter table public.youtube_daily_usage enable row level security;
alter table public.skill_video_catalog enable row level security;
alter table public.discovery_requests  enable row level security;

drop policy if exists "skill_video_catalog_authenticated_select"
  on public.skill_video_catalog;
create policy "skill_video_catalog_authenticated_select"
  on public.skill_video_catalog
  for select to authenticated using (true);
-- youtube_daily_usage and discovery_requests: no policies (service_role only).

-- ===========================================================================
-- VERIFICATION (run manually; not part of the migration)
-- ===========================================================================
-- (a) Each should raise an exception:
--   select reserve_youtube_units(-1, 3000);
--   select reserve_youtube_units(0, 3000);
--   select reserve_youtube_units(100, null);
--   select reserve_youtube_units(100, 3000, 'invalid');
-- (b) Anon and authenticated must be denied:
--   begin; set role anon; select reserve_youtube_units(100, 3000); rollback;
--   begin; set role authenticated; select reserve_youtube_units(100, 3000); rollback;
--   Expect: permission denied for function
-- (c) Race: Session A: begin; select reserve_youtube_units(2900, 3000); (leave open)
--   Session B: same call; it blocks. Commit A; B returns false.
--   (If A rolls back instead, B returns true.)
-- (d) Cleanup after tests:
--   delete from youtube_daily_usage
--   where usage_date = (now() at time zone 'America/Los_Angeles')::date;
