-- Appointment length from booking sites (GlossGenius JSON-LD eligibleDuration, etc.).

alter table public.professional_services
  add column if not exists duration_minutes integer;

comment on column public.professional_services.duration_minutes is
  'Typical appointment length in minutes (from booking site JSON-LD / Book Now pages).';
