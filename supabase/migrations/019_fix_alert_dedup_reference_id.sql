-- 019_fix_alert_dedup_reference_id.sql
-- Adds reference_id to the alert_dispatch_log index so dedup is scoped
-- to the specific job/skill/reference, not just (user_id, alert_type).

create index if not exists idx_alert_dispatch_log_user_type_ref_sent
  on alert_dispatch_log (user_id, alert_type, reference_id, sent_at desc);
