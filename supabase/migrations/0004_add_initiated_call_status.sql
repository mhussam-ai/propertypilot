-- Bolna's call lifecycle includes an `initiated` status (emitted between `queued`
-- and `dialing`) that the original `call_status` enum (0001_init.sql) omitted.
-- call-start.ts / call-finalize.ts / bolna-sync-calls.ts persist Bolna's status
-- verbatim, so without this value an `initiated` update fails the enum check.
-- Add it so we store Bolna's status faithfully. Keep lib/supabase/database.types.ts
-- in sync (it lists the same value) — regenerate with `pnpm supabase:types` after applying.
alter type public.call_status add value if not exists 'initiated' before 'dialing';
