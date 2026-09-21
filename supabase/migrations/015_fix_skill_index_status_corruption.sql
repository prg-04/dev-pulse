-- Fix skill_index_status data corruption: some rows have JSON in the skill column
-- instead of plain text. Clean them up and add a constraint to prevent recurrence.

-- 1. Identify corrupted rows for logging / manual review before deletion.
--    A valid skill is a non-empty text value that does not start with [ or {.
create table if not exists _skill_index_status_corruption_audit as
select skill, last_indexed_at, last_run_status, last_error
from skill_index_status
where skill is null
   or trim(skill) = ''
   or skill ~ '^\s*[\{\[]';

-- 2. Delete corrupted rows. They cannot be meaningfully recovered because the
--    primary key is the skill name itself.
delete from skill_index_status
where skill is null
   or trim(skill) = ''
   or skill ~ '^\s*[\{\[]';

-- 3. Add a check constraint so future inserts/upserts cannot corrupt this column.
alter table skill_index_status
  drop constraint if exists skill_index_status_skill_text_check;

alter table skill_index_status
  add constraint skill_index_status_skill_text_check
  check (
    skill is not null
    and trim(skill) <> ''
    and skill !~ '^\s*[\{\[]'
  );

-- 4. Drop the audit staging table.
drop table if exists _skill_index_status_corruption_audit;
