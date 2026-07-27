-- Allow service_role full access for backfills / admin scripts.
grant select, insert, update, delete on public.jobs to service_role;
