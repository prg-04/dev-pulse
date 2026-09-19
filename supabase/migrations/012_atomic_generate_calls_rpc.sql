-- Atomic increment for ai_daily_usage.generate_calls
-- Replaces the racy read-then-upsert pattern in tutorial-index and tutorial-lesson-step
-- with a single atomic upsert so concurrent cron invocations cannot drop increments.

create or replace function public.increment_generate_calls(
  p_usage_date text,
  p_delta integer
)
returns void
language plpgsql
as $$
begin
  insert into public.ai_daily_usage (usage_date, generate_calls, updated_at)
  values (p_usage_date, p_delta, now())
  on conflict (usage_date) do update
    set generate_calls = ai_daily_usage.generate_calls + p_delta,
        updated_at = now();
end;
$$;
