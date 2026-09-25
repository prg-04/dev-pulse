-- 017_move_cooldown_into_enqueue_discovery_request.sql
-- Moves the 30-minute dedup from the client-side shouldEnqueueSkill guard
-- into the enqueue_discovery_request RPC itself.
--
-- Behavior change:
--   Before: every call incremented request_count and refreshed requested_at.
--   After:  if discovery_requests.requested_at is within the last 30 minutes,
--           the function no-ops and returns without touching the row.
--           Otherwise it upserts as before.

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

  -- Server-side cooldown: if a request for this skill was made within the
  -- last 30 minutes, do not bump request_count or refresh requested_at.
  if exists (
    select 1
    from public.discovery_requests
    where skill = trim(p_skill)
      and requested_at > now() - interval '30 minutes'
  ) then
    return;
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
