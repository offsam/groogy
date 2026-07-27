-- B1 (ARCHITECTURE_ALIGNMENT_ROADMAP): the platform gets a pulse.
-- pg_cron calls the single maintenance entry point daily; add future sweeps
-- INSIDE run_scheduled_maintenance(), never as parallel cron jobs.
create extension if not exists pg_cron;

select cron.schedule(
  'platform-maintenance',
  '0 9 * * *',  -- daily 09:00 UTC ≈ 01:00 PT
  $$select public.run_scheduled_maintenance();$$
);
