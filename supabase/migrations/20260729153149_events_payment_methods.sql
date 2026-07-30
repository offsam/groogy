-- Event payment methods (PayPal, Venmo, Cash, …) for the affiche.

alter table public.events
  add column if not exists payment_methods text[] not null default '{}';

comment on column public.events.payment_methods is
  'Accepted payment methods from the post, e.g. {PayPal,Venmo,Cash}.';

notify pgrst, 'reload schema';
