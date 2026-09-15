-- DevPulse 10-source expansion per AGENTS.md §10/§11
-- Expands job_postings.source check from 4 to 10 values and profiles.monitored_sources default to 10

-- 1) job_postings source check
do $$
begin
  -- Drop old check if exists (name may vary — try common variants)
  if exists (select 1 from pg_constraint where conname = 'job_postings_source_check' and conrelid = 'job_postings'::regclass) then
    alter table job_postings drop constraint job_postings_source_check;
  end if;
  -- Also handle auto-generated constraint name variant
  -- The original is: check (source in ('hackernews','himalayas','remotejobs','remotive'))
  -- Postgres names it job_postings_source_check automatically
end$$;

alter table job_postings
  add constraint job_postings_source_check
  check (source in ('hackernews','himalayas','remotejobs','remotive','arbeitnow','remoteok','jobicy','adzuna','jooble','themuse'));

-- 2) profiles monitored_sources default: expand from 4 to 10
alter table profiles
  alter column monitored_sources set default '{hackernews,himalayas,remotejobs,remotive,arbeitnow,remoteok,jobicy,adzuna,jooble,themuse}';

-- Existing rows keep their old 4-element defaults unless updated; new profiles get 10.
-- Backfill nulls if any (defensive)
update profiles set monitored_sources = '{hackernews,himalayas,remotejobs,remotive,arbeitnow,remoteok,jobicy,adzuna,jooble,themuse}'
where monitored_sources is null;
