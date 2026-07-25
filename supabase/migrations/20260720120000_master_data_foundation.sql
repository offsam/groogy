-- Pack 2.5A: Master Data foundation
-- Geography (US), languages, currencies, units, features, category extensions.
-- Non-destructive: does not drop legacy city/state/region text columns.
-- Does NOT import counties/cities (~32k) — use scripts/master-data/import-us-geography.py.
-- Do NOT edit Pack 1/2 migrations; this file is additive only.

-- ============ EXTENSIONS ============
create extension if not exists pg_trgm with schema extensions;

-- ============ PLATFORM CURRENCIES ============
create table public.platform_currencies (
  code         text primary key,
  name_en      text not null,
  symbol       text not null,
  minor_units  integer not null default 2 check (minor_units >= 0 and minor_units <= 6),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint platform_currencies_code_chk check (code ~ '^[A-Z]{3}$')
);

create trigger platform_currencies_set_updated_at
  before update on public.platform_currencies
  for each row execute function public.set_updated_at();

insert into public.platform_currencies (code, name_en, symbol, minor_units, is_active, sort_order)
values
  ('USD', 'US Dollar', '$', 2, true, 10),
  ('EUR', 'Euro', '€', 2, false, 20),
  ('GBP', 'British Pound', '£', 2, false, 30)
on conflict (code) do nothing;

-- ============ PLATFORM COUNTRIES ============
create table public.platform_countries (
  iso2                   text primary key,
  iso3                   text not null unique,
  name_en                text not null,
  name_ru                text,
  phone_code             text,
  default_currency_code  text references public.platform_currencies(code) on delete set null,
  is_active              boolean not null default true,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint platform_countries_iso2_chk check (iso2 ~ '^[A-Z]{2}$'),
  constraint platform_countries_iso3_chk check (iso3 ~ '^[A-Z]{3}$')
);

create trigger platform_countries_set_updated_at
  before update on public.platform_countries
  for each row execute function public.set_updated_at();

insert into public.platform_countries (
  iso2, iso3, name_en, name_ru, phone_code, default_currency_code, is_active, sort_order
)
values
  ('US', 'USA', 'United States', 'США', '+1', 'USD', true, 10)
on conflict (iso2) do nothing;

-- ============ PLATFORM SUBDIVISIONS (US states / DC / territories) ============
create table public.platform_subdivisions (
  code            text primary key,
  country_iso2    text not null references public.platform_countries(iso2) on delete restrict,
  fips_code       text unique,
  abbreviation    text not null,
  name_en         text not null,
  name_ru         text,
  slug            text not null,
  is_active       boolean not null default true,
  is_selectable   boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint platform_subdivisions_abbr_chk check (char_length(abbreviation) between 2 and 3),
  unique (country_iso2, slug),
  unique (country_iso2, abbreviation)
);

create index platform_subdivisions_country_active_idx
  on public.platform_subdivisions (country_iso2, is_active, is_selectable, sort_order);

create trigger platform_subdivisions_set_updated_at
  before update on public.platform_subdivisions
  for each row execute function public.set_updated_at();

insert into public.platform_subdivisions (
  code, country_iso2, fips_code, abbreviation, name_en, name_ru, slug,
  is_active, is_selectable, sort_order
)
values
  ('US-AL', 'US', '01', 'AL', 'Alabama', null, 'alabama', true, true, 10),
  ('US-AK', 'US', '02', 'AK', 'Alaska', null, 'alaska', true, true, 20),
  ('US-AZ', 'US', '04', 'AZ', 'Arizona', null, 'arizona', true, true, 30),
  ('US-AR', 'US', '05', 'AR', 'Arkansas', null, 'arkansas', true, true, 40),
  ('US-CA', 'US', '06', 'CA', 'California', null, 'california', true, true, 50),
  ('US-CO', 'US', '08', 'CO', 'Colorado', null, 'colorado', true, true, 60),
  ('US-CT', 'US', '09', 'CT', 'Connecticut', null, 'connecticut', true, true, 70),
  ('US-DE', 'US', '10', 'DE', 'Delaware', null, 'delaware', true, true, 80),
  ('US-DC', 'US', '11', 'DC', 'District of Columbia', null, 'district-of-columbia', true, true, 90),
  ('US-FL', 'US', '12', 'FL', 'Florida', null, 'florida', true, true, 100),
  ('US-GA', 'US', '13', 'GA', 'Georgia', null, 'georgia', true, true, 110),
  ('US-HI', 'US', '15', 'HI', 'Hawaii', null, 'hawaii', true, true, 120),
  ('US-ID', 'US', '16', 'ID', 'Idaho', null, 'idaho', true, true, 130),
  ('US-IL', 'US', '17', 'IL', 'Illinois', null, 'illinois', true, true, 140),
  ('US-IN', 'US', '18', 'IN', 'Indiana', null, 'indiana', true, true, 150),
  ('US-IA', 'US', '19', 'IA', 'Iowa', null, 'iowa', true, true, 160),
  ('US-KS', 'US', '20', 'KS', 'Kansas', null, 'kansas', true, true, 170),
  ('US-KY', 'US', '21', 'KY', 'Kentucky', null, 'kentucky', true, true, 180),
  ('US-LA', 'US', '22', 'LA', 'Louisiana', null, 'louisiana', true, true, 190),
  ('US-ME', 'US', '23', 'ME', 'Maine', null, 'maine', true, true, 200),
  ('US-MD', 'US', '24', 'MD', 'Maryland', null, 'maryland', true, true, 210),
  ('US-MA', 'US', '25', 'MA', 'Massachusetts', null, 'massachusetts', true, true, 220),
  ('US-MI', 'US', '26', 'MI', 'Michigan', null, 'michigan', true, true, 230),
  ('US-MN', 'US', '27', 'MN', 'Minnesota', null, 'minnesota', true, true, 240),
  ('US-MS', 'US', '28', 'MS', 'Mississippi', null, 'mississippi', true, true, 250),
  ('US-MO', 'US', '29', 'MO', 'Missouri', null, 'missouri', true, true, 260),
  ('US-MT', 'US', '30', 'MT', 'Montana', null, 'montana', true, true, 270),
  ('US-NE', 'US', '31', 'NE', 'Nebraska', null, 'nebraska', true, true, 280),
  ('US-NV', 'US', '32', 'NV', 'Nevada', null, 'nevada', true, true, 290),
  ('US-NH', 'US', '33', 'NH', 'New Hampshire', null, 'new-hampshire', true, true, 300),
  ('US-NJ', 'US', '34', 'NJ', 'New Jersey', null, 'new-jersey', true, true, 310),
  ('US-NM', 'US', '35', 'NM', 'New Mexico', null, 'new-mexico', true, true, 320),
  ('US-NY', 'US', '36', 'NY', 'New York', null, 'new-york', true, true, 330),
  ('US-NC', 'US', '37', 'NC', 'North Carolina', null, 'north-carolina', true, true, 340),
  ('US-ND', 'US', '38', 'ND', 'North Dakota', null, 'north-dakota', true, true, 350),
  ('US-OH', 'US', '39', 'OH', 'Ohio', null, 'ohio', true, true, 360),
  ('US-OK', 'US', '40', 'OK', 'Oklahoma', null, 'oklahoma', true, true, 370),
  ('US-OR', 'US', '41', 'OR', 'Oregon', null, 'oregon', true, true, 380),
  ('US-PA', 'US', '42', 'PA', 'Pennsylvania', null, 'pennsylvania', true, true, 390),
  ('US-RI', 'US', '44', 'RI', 'Rhode Island', null, 'rhode-island', true, true, 400),
  ('US-SC', 'US', '45', 'SC', 'South Carolina', null, 'south-carolina', true, true, 410),
  ('US-SD', 'US', '46', 'SD', 'South Dakota', null, 'south-dakota', true, true, 420),
  ('US-TN', 'US', '47', 'TN', 'Tennessee', null, 'tennessee', true, true, 430),
  ('US-TX', 'US', '48', 'TX', 'Texas', null, 'texas', true, true, 440),
  ('US-UT', 'US', '49', 'UT', 'Utah', null, 'utah', true, true, 450),
  ('US-VT', 'US', '50', 'VT', 'Vermont', null, 'vermont', true, true, 460),
  ('US-VA', 'US', '51', 'VA', 'Virginia', null, 'virginia', true, true, 470),
  ('US-WA', 'US', '53', 'WA', 'Washington', null, 'washington', true, true, 480),
  ('US-WV', 'US', '54', 'WV', 'West Virginia', null, 'west-virginia', true, true, 490),
  ('US-WI', 'US', '55', 'WI', 'Wisconsin', null, 'wisconsin', true, true, 500),
  ('US-WY', 'US', '56', 'WY', 'Wyoming', null, 'wyoming', true, true, 510),
  ('US-AS', 'US', '60', 'AS', 'American Samoa', null, 'american-samoa', true, false, 910),
  ('US-GU', 'US', '66', 'GU', 'Guam', null, 'guam', true, false, 920),
  ('US-MP', 'US', '69', 'MP', 'Northern Mariana Islands', null, 'northern-mariana-islands', true, false, 930),
  ('US-PR', 'US', '72', 'PR', 'Puerto Rico', null, 'puerto-rico', true, false, 940),
  ('US-UM', 'US', '74', 'UM', 'U.S. Minor Outlying Islands', null, 'us-minor-outlying-islands', true, false, 950),
  ('US-VI', 'US', '78', 'VI', 'U.S. Virgin Islands', null, 'us-virgin-islands', true, false, 960)
on conflict (code) do nothing;

-- ============ PLATFORM COUNTIES (empty — imported later) ============
create table public.platform_counties (
  geoid            text primary key,
  state_code       text not null references public.platform_subdivisions(code) on delete restrict,
  fips_code        text not null,
  name             text not null,
  name_normalized  text not null,
  slug             text not null,
  is_active        boolean not null default true,
  latitude         double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude        double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint platform_counties_geoid_chk check (geoid ~ '^\d{5}$'),
  unique (state_code, slug),
  unique (state_code, fips_code)
);

create index platform_counties_state_name_idx
  on public.platform_counties (state_code, name_normalized);
create index platform_counties_active_idx
  on public.platform_counties (is_active)
  where is_active;

create trigger platform_counties_set_updated_at
  before update on public.platform_counties
  for each row execute function public.set_updated_at();

-- ============ PLATFORM CITIES (empty — imported later) ============
create table public.platform_cities (
  geoid                 text primary key,
  state_code            text not null references public.platform_subdivisions(code) on delete restrict,
  primary_county_geoid  text references public.platform_counties(geoid) on delete set null,
  ansicode              text,
  name                  text not null,
  name_normalized       text not null,
  slug                  text not null,
  lsad                  text,
  latitude              double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude             double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  land_sq_mi            numeric(12,4),
  is_active             boolean not null default true,
  population            integer check (population is null or population >= 0),
  population_year       integer check (population_year is null or (population_year >= 1790 and population_year <= 2100)),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint platform_cities_geoid_chk check (geoid ~ '^\d{7}$'),
  unique (state_code, slug)
);

create index platform_cities_state_name_norm_idx
  on public.platform_cities (state_code, name_normalized);
create index platform_cities_state_name_lower_pattern_idx
  on public.platform_cities (state_code, lower(name_normalized) text_pattern_ops);
create index platform_cities_name_trgm_idx
  on public.platform_cities using gin (name_normalized extensions.gin_trgm_ops);
create index platform_cities_active_idx
  on public.platform_cities (is_active)
  where is_active;
create index platform_cities_geoid_idx
  on public.platform_cities (geoid);

create trigger platform_cities_set_updated_at
  before update on public.platform_cities
  for each row execute function public.set_updated_at();

-- ============ PLATFORM CITY ↔ COUNTY (optional junction, empty) ============
create table public.platform_city_counties (
  city_geoid    text not null references public.platform_cities(geoid) on delete cascade,
  county_geoid  text not null references public.platform_counties(geoid) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (city_geoid, county_geoid)
);

create index platform_city_counties_county_idx
  on public.platform_city_counties (county_geoid);

-- ============ PLATFORM LANGUAGES ============
create table public.platform_languages (
  code            text primary key,
  name_en         text not null,
  name_native     text,
  name_ru         text,
  is_rtl          boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  search_aliases  text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint platform_languages_code_chk check (char_length(code) between 2 and 16)
);

create index platform_languages_active_sort_idx
  on public.platform_languages (is_active, sort_order);

create trigger platform_languages_set_updated_at
  before update on public.platform_languages
  for each row execute function public.set_updated_at();

insert into public.platform_languages (
  code, name_en, name_native, name_ru, is_rtl, is_active, sort_order, search_aliases
)
values
  ('en',  'English',                 'English',              'Английский',              false, true, 10,  array['english']),
  ('ru',  'Russian',                 'Русский',              'Русский',                 false, true, 20,  array['russian','русский']),
  ('uk',  'Ukrainian',               'Українська',           'Украинский',              false, true, 30,  array['ukrainian','українська']),
  ('es',  'Spanish',                 'Español',              'Испанский',               false, true, 40,  array['spanish','español']),
  ('hy',  'Armenian',                'Հայերեն',               'Армянский',               false, true, 50,  array['armenian']),
  ('be',  'Belarusian',              'Беларуская',           'Белорусский',             false, true, 60,  array['belarusian','белорусский']),
  ('he',  'Hebrew',                  'עברית',                'Иврит',                   true,  true, 70,  array['hebrew','ivrit']),
  ('ka',  'Georgian',                'ქართული',              'Грузинский',              false, true, 80,  array['georgian']),
  ('uz',  'Uzbek',                   'Oʻzbekcha',            'Узбекский',               false, true, 90,  array['uzbek']),
  ('kk',  'Kazakh',                  'Қазақша',              'Казахский',               false, true, 100, array['kazakh']),
  ('ky',  'Kyrgyz',                  'Кыргызча',             'Киргизский',              false, true, 110, array['kyrgyz','kirghiz']),
  ('az',  'Azerbaijani',             'Azərbaycan',           'Азербайджанский',         false, true, 120, array['azerbaijani','azeri']),
  ('ro',  'Romanian',                'Română',               'Румынский',               false, true, 130, array['romanian']),
  ('pl',  'Polish',                  'Polski',               'Польский',                false, true, 140, array['polish']),
  ('de',  'German',                  'Deutsch',              'Немецкий',                false, true, 150, array['german','deutsch']),
  ('fr',  'French',                  'Français',             'Французский',             false, true, 160, array['french','français']),
  ('zh',  'Chinese',                 '中文',                  'Китайский',               false, true, 170, array['chinese','mandarin']),
  ('ko',  'Korean',                  '한국어',                'Корейский',               false, true, 180, array['korean']),
  ('vi',  'Vietnamese',              'Tiếng Việt',           'Вьетнамский',             false, true, 190, array['vietnamese']),
  ('ar',  'Arabic',                  'العربية',               'Арабский',                true,  true, 200, array['arabic']),
  ('fa',  'Persian',                 'فارسی',                'Персидский',              true,  true, 210, array['persian','farsi']),
  ('tr',  'Turkish',                 'Türkçe',               'Турецкий',                false, true, 220, array['turkish']),
  ('pt',  'Portuguese',              'Português',            'Португальский',           false, true, 230, array['portuguese']),
  ('hi',  'Hindi',                   'हिन्दी',                 'Хинди',                   false, true, 240, array['hindi']),
  ('ase', 'American Sign Language',  'ASL',                  'Американский жестовый',   false, true, 250, array['asl','american sign language','sgn-US']),
  ('other','Other',                  'Other',                'Другой',                  false, true, 900, array['other','другой'])
on conflict (code) do nothing;

-- ============ PLATFORM UNITS ============
create table public.platform_units (
  code                 text primary key,
  category             text not null,
  label_en_singular    text not null,
  label_en_plural      text not null,
  label_ru_singular    text,
  label_ru_plural      text,
  short_label          text,
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint platform_units_category_chk check (
    category in ('count', 'time', 'distance', 'area', 'mass')
  )
);

create index platform_units_category_active_idx
  on public.platform_units (category, is_active, sort_order);

create trigger platform_units_set_updated_at
  before update on public.platform_units
  for each row execute function public.set_updated_at();

insert into public.platform_units (
  code, category, label_en_singular, label_en_plural,
  label_ru_singular, label_ru_plural, short_label, is_active, sort_order
)
values
  ('item',       'count',    'item',       'items',       'штука',   'штуки',     'item',  true, 10),
  ('piece',      'count',    'piece',      'pieces',      'шт.',     'шт.',       'pc',    true, 20),
  ('hour',       'time',     'hour',       'hours',       'час',     'часы',      'hr',    true, 30),
  ('day',        'time',     'day',        'days',        'день',    'дни',       'day',   true, 40),
  ('week',       'time',     'week',       'weeks',       'неделя',  'недели',    'wk',    true, 50),
  ('month',      'time',     'month',      'months',      'месяц',   'месяцы',    'mo',    true, 60),
  ('year',       'time',     'year',       'years',       'год',     'годы',      'yr',    true, 70),
  ('mile',       'distance', 'mile',       'miles',       'миля',    'мили',      'mi',    true, 80),
  ('kilometer',  'distance', 'kilometer',  'kilometers',  'километр','километры', 'km',    true, 90),
  ('sq_ft',      'area',     'square foot','square feet', 'кв. фут', 'кв. футы',  'sq ft', true, 100),
  ('sq_m',       'area',     'square meter','square meters','кв. м', 'кв. м',     'm²',    true, 110),
  ('lb',         'mass',     'pound',      'pounds',      'фунт',    'фунты',     'lb',    true, 120),
  ('kg',         'mass',     'kilogram',   'kilograms',   'килограмм','килограммы','kg',   true, 130)
on conflict (code) do nothing;

-- ============ PLATFORM FEATURES ============
create table public.platform_features (
  id                            uuid primary key default gen_random_uuid(),
  code                          text not null unique,
  domains                       text[] not null,
  name_en                       text not null,
  name_ru                       text,
  description                   text,
  is_active                     boolean not null default true,
  sort_order                    integer not null default 0,
  verification_status_supported boolean not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint platform_features_domains_chk check (
    cardinality(domains) >= 1
    and domains <@ array['business', 'marketplace', 'services']::text[]
  ),
  constraint platform_features_code_chk check (code ~ '^[a-z][a-z0-9_]*$')
);

create index platform_features_active_sort_idx
  on public.platform_features (is_active, sort_order);
create index platform_features_domains_gin_idx
  on public.platform_features using gin (domains);

create trigger platform_features_set_updated_at
  before update on public.platform_features
  for each row execute function public.set_updated_at();

insert into public.platform_features (
  code, domains, name_en, name_ru, description, is_active, sort_order, verification_status_supported
)
values
  ('russian_speaking',      array['business','services'], 'Russian speaking',      'Говорят по-русски',     'Staff or provider can communicate in Russian.', true, 10, false),
  ('open_24_7',             array['business','services'], 'Open 24/7',             'Круглосуточно',        'Available twenty-four hours, seven days a week.', true, 20, false),
  ('emergency',             array['business','services'], 'Emergency',             'Экстренно',            'Emergency or urgent availability.', true, 30, false),
  ('same_day',              array['business','services'], 'Same day',              'В день обращения',     'Same-day service or appointment available.', true, 40, false),
  ('weekend',               array['business','services'], 'Weekend availability',  'Выходные',             'Available on weekends.', true, 50, false),
  ('mobile_service',        array['business','services'], 'Mobile service',        'Выезд',                'Provider travels to the customer.', true, 60, false),
  ('remote',                array['business','services'], 'Remote',                'Удалённо',             'Remote / online delivery.', true, 70, false),
  ('free_estimate',         array['business','services'], 'Free estimate',         'Бесплатная оценка',    'Free estimate or quote offered.', true, 80, false),
  ('licensed',              array['business','services'], 'Licensed',              'Лицензирован',         'Self-declared definition only — not platform-verified licensure.', true, 90, false),
  ('insured',               array['business','services'], 'Insured',               'Застрахован',          'Self-declared definition only — not platform-verified insurance.', true, 100, false),
  ('wheelchair_accessible', array['business','services'], 'Wheelchair accessible', 'Доступно для инвалидных колясок', 'Physical location or service is wheelchair accessible.', true, 110, false),
  ('appointment_required',  array['business','services'], 'Appointment required',  'По записи',            'Appointment required before visit or service.', true, 120, false)
on conflict (code) do nothing;

-- ============ PLATFORM DATA SOURCES ============
create table public.platform_data_sources (
  id            uuid primary key default gen_random_uuid(),
  source_name   text not null,
  dataset_name  text not null,
  version       text,
  retrieved_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger platform_data_sources_set_updated_at
  before update on public.platform_data_sources
  for each row execute function public.set_updated_at();

insert into public.platform_data_sources (source_name, dataset_name, version, retrieved_at, notes)
select
  'U.S. Census Bureau',
  '2024 Gazetteer Files (national counties + places)',
  '2024',
  timestamptz '2026-07-19',
  'Source files under scripts/master-data/data/. Import via scripts/master-data/import-us-geography.py. App has no runtime Census API dependency.'
where not exists (
  select 1 from public.platform_data_sources
  where source_name = 'U.S. Census Bureau'
    and dataset_name = '2024 Gazetteer Files (national counties + places)'
);

-- ============ CATEGORY EXTENSIONS (non-destructive) ============
alter table public.listing_categories
  add column if not exists icon_key text,
  add column if not exists description text,
  add column if not exists is_selectable boolean not null default true,
  add column if not exists disclaimer_text text;

alter table public.categories
  add column if not exists name_en text,
  add column if not exists description text,
  add column if not exists disclaimer_text text,
  add column if not exists domain text not null default 'business';

alter table public.categories
  drop constraint if exists categories_domain_chk;

alter table public.categories
  add constraint categories_domain_chk check (
    domain in ('business', 'marketplace', 'services')
  );

-- ============ LOCATION FKs ON EXISTING TABLES (nullable) ============
alter table public.listings
  add column if not exists state_code text references public.platform_subdivisions(code) on delete set null,
  add column if not exists city_geoid text references public.platform_cities(geoid) on delete set null;

alter table public.profiles
  add column if not exists state_code text references public.platform_subdivisions(code) on delete set null,
  add column if not exists city_geoid text references public.platform_cities(geoid) on delete set null;

alter table public.businesses
  add column if not exists state_code text references public.platform_subdivisions(code) on delete set null,
  add column if not exists city_geoid text references public.platform_cities(geoid) on delete set null;

create index if not exists listings_state_code_idx
  on public.listings (state_code)
  where state_code is not null;
create index if not exists listings_city_geoid_idx
  on public.listings (city_geoid)
  where city_geoid is not null;
create index if not exists profiles_state_code_idx
  on public.profiles (state_code)
  where state_code is not null;
create index if not exists profiles_city_geoid_idx
  on public.profiles (city_geoid)
  where city_geoid is not null;
create index if not exists businesses_state_code_idx
  on public.businesses (state_code)
  where state_code is not null;
create index if not exists businesses_city_geoid_idx
  on public.businesses (city_geoid)
  where city_geoid is not null;

-- ============ RLS: FORCE on all platform_* tables ============
alter table public.platform_countries enable row level security;
alter table public.platform_countries force row level security;
alter table public.platform_subdivisions enable row level security;
alter table public.platform_subdivisions force row level security;
alter table public.platform_counties enable row level security;
alter table public.platform_counties force row level security;
alter table public.platform_cities enable row level security;
alter table public.platform_cities force row level security;
alter table public.platform_city_counties enable row level security;
alter table public.platform_city_counties force row level security;
alter table public.platform_languages enable row level security;
alter table public.platform_languages force row level security;
alter table public.platform_currencies enable row level security;
alter table public.platform_currencies force row level security;
alter table public.platform_units enable row level security;
alter table public.platform_units force row level security;
alter table public.platform_features enable row level security;
alter table public.platform_features force row level security;
alter table public.platform_data_sources enable row level security;
alter table public.platform_data_sources force row level security;

-- Grants: SELECT only for clients; writes via admin SECURITY DEFINER RPCs
revoke all on table public.platform_countries from anon, authenticated;
revoke all on table public.platform_subdivisions from anon, authenticated;
revoke all on table public.platform_counties from anon, authenticated;
revoke all on table public.platform_cities from anon, authenticated;
revoke all on table public.platform_city_counties from anon, authenticated;
revoke all on table public.platform_languages from anon, authenticated;
revoke all on table public.platform_currencies from anon, authenticated;
revoke all on table public.platform_units from anon, authenticated;
revoke all on table public.platform_features from anon, authenticated;
revoke all on table public.platform_data_sources from anon, authenticated;

grant select on table public.platform_countries to anon, authenticated;
grant select on table public.platform_subdivisions to anon, authenticated;
grant select on table public.platform_counties to anon, authenticated;
grant select on table public.platform_cities to anon, authenticated;
grant select on table public.platform_city_counties to anon, authenticated;
grant select on table public.platform_languages to anon, authenticated;
grant select on table public.platform_currencies to anon, authenticated;
grant select on table public.platform_units to anon, authenticated;
grant select on table public.platform_features to anon, authenticated;
grant select on table public.platform_data_sources to authenticated;

-- Public active reads
drop policy if exists platform_countries_public_select on public.platform_countries;
create policy platform_countries_public_select
  on public.platform_countries for select to anon, authenticated
  using (is_active);

drop policy if exists platform_countries_admin_select on public.platform_countries;
create policy platform_countries_admin_select
  on public.platform_countries for select to authenticated
  using (public.is_admin());

drop policy if exists platform_subdivisions_public_select on public.platform_subdivisions;
create policy platform_subdivisions_public_select
  on public.platform_subdivisions for select to anon, authenticated
  using (is_active and is_selectable);

drop policy if exists platform_subdivisions_admin_select on public.platform_subdivisions;
create policy platform_subdivisions_admin_select
  on public.platform_subdivisions for select to authenticated
  using (public.is_admin());

drop policy if exists platform_counties_public_select on public.platform_counties;
create policy platform_counties_public_select
  on public.platform_counties for select to anon, authenticated
  using (is_active);

drop policy if exists platform_counties_admin_select on public.platform_counties;
create policy platform_counties_admin_select
  on public.platform_counties for select to authenticated
  using (public.is_admin());

drop policy if exists platform_cities_public_select on public.platform_cities;
create policy platform_cities_public_select
  on public.platform_cities for select to anon, authenticated
  using (is_active);

drop policy if exists platform_cities_admin_select on public.platform_cities;
create policy platform_cities_admin_select
  on public.platform_cities for select to authenticated
  using (public.is_admin());

-- Junction: readable when both ends are active (via exists); keep simple active-city join later
drop policy if exists platform_city_counties_public_select on public.platform_city_counties;
create policy platform_city_counties_public_select
  on public.platform_city_counties for select to anon, authenticated
  using (
    exists (
      select 1 from public.platform_cities c
      where c.geoid = city_geoid and c.is_active
    )
  );

drop policy if exists platform_city_counties_admin_select on public.platform_city_counties;
create policy platform_city_counties_admin_select
  on public.platform_city_counties for select to authenticated
  using (public.is_admin());

drop policy if exists platform_languages_public_select on public.platform_languages;
create policy platform_languages_public_select
  on public.platform_languages for select to anon, authenticated
  using (is_active);

drop policy if exists platform_languages_admin_select on public.platform_languages;
create policy platform_languages_admin_select
  on public.platform_languages for select to authenticated
  using (public.is_admin());

drop policy if exists platform_currencies_public_select on public.platform_currencies;
create policy platform_currencies_public_select
  on public.platform_currencies for select to anon, authenticated
  using (is_active);

drop policy if exists platform_currencies_admin_select on public.platform_currencies;
create policy platform_currencies_admin_select
  on public.platform_currencies for select to authenticated
  using (public.is_admin());

drop policy if exists platform_units_public_select on public.platform_units;
create policy platform_units_public_select
  on public.platform_units for select to anon, authenticated
  using (is_active);

drop policy if exists platform_units_admin_select on public.platform_units;
create policy platform_units_admin_select
  on public.platform_units for select to authenticated
  using (public.is_admin());

drop policy if exists platform_features_public_select on public.platform_features;
create policy platform_features_public_select
  on public.platform_features for select to anon, authenticated
  using (is_active);

drop policy if exists platform_features_admin_select on public.platform_features;
create policy platform_features_admin_select
  on public.platform_features for select to authenticated
  using (public.is_admin());

drop policy if exists platform_data_sources_admin_select on public.platform_data_sources;
create policy platform_data_sources_admin_select
  on public.platform_data_sources for select to authenticated
  using (public.is_admin());

-- ============ PUBLIC VIEWS ============
create or replace view public.platform_us_states_public
with (security_invoker = true) as
select
  code, country_iso2, fips_code, abbreviation, name_en, name_ru, slug, sort_order
from public.platform_subdivisions
where country_iso2 = 'US'
  and is_active
  and is_selectable
order by sort_order, name_en;

create or replace view public.platform_languages_public
with (security_invoker = true) as
select
  code, name_en, name_native, name_ru, is_rtl, sort_order, search_aliases
from public.platform_languages
where is_active
order by sort_order, name_en;

create or replace view public.platform_currencies_public
with (security_invoker = true) as
select code, name_en, symbol, minor_units, sort_order
from public.platform_currencies
where is_active
order by sort_order, code;

create or replace view public.platform_units_public
with (security_invoker = true) as
select
  code, category, label_en_singular, label_en_plural,
  label_ru_singular, label_ru_plural, short_label, sort_order
from public.platform_units
where is_active
order by sort_order, code;

create or replace view public.platform_features_public
with (security_invoker = true) as
select
  id, code, domains, name_en, name_ru, description,
  sort_order, verification_status_supported
from public.platform_features
where is_active
order by sort_order, code;

grant select on public.platform_us_states_public to anon, authenticated;
grant select on public.platform_languages_public to anon, authenticated;
grant select on public.platform_currencies_public to anon, authenticated;
grant select on public.platform_units_public to anon, authenticated;
grant select on public.platform_features_public to anon, authenticated;

-- ============ HELPERS ============
create or replace function public.normalize_place_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select nullif(
    lower(btrim(regexp_replace(coalesce(p_name, ''), '[^[:alnum:][:space:]\-]+', '', 'g'))),
    ''
  );
$$;

revoke all on function public.normalize_place_name(text) from public;
grant execute on function public.normalize_place_name(text) to anon, authenticated;

create or replace function public.search_platform_cities(
  p_query text,
  p_state_code text default null,
  p_limit integer default 20
)
returns table (
  geoid text,
  state_code text,
  name text,
  name_normalized text,
  slug text,
  latitude double precision,
  longitude double precision,
  population integer
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  q text := public.normalize_place_name(p_query);
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 20);
begin
  if q is null or char_length(q) < 2 then
    return;
  end if;

  return query
  select
    c.geoid,
    c.state_code,
    c.name,
    c.name_normalized,
    c.slug,
    c.latitude,
    c.longitude,
    c.population
  from public.platform_cities c
  where c.is_active
    and (p_state_code is null or c.state_code = p_state_code)
    and (
      c.name_normalized like q || '%'
      or c.name_normalized like '% ' || q || '%'
      or c.name_normalized % q
    )
  order by
    case when c.name_normalized = q then 0
         when c.name_normalized like q || '%' then 1
         else 2 end,
    char_length(c.name_normalized),
    c.name_normalized
  limit lim;
end;
$$;

revoke all on function public.search_platform_cities(text, text, integer) from public;
grant execute on function public.search_platform_cities(text, text, integer) to anon, authenticated;

-- ============ ADMIN RPCs (Pack 2 style) ============
create or replace function public.admin_upsert_listing_category(
  p_id uuid default null,
  p_slug text default null,
  p_name_ru text default null,
  p_name_en text default null,
  p_parent_id uuid default null,
  p_listing_type listing_type default null,
  p_domain listing_domain default null,
  p_sort_order integer default null,
  p_is_active boolean default null,
  p_icon_key text default null,
  p_description text default null,
  p_is_selectable boolean default null,
  p_disclaimer_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid;
begin
  if uid is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_id is not null then
    update public.listing_categories c
    set
      slug = coalesce(nullif(btrim(p_slug), ''), c.slug),
      name_ru = coalesce(nullif(btrim(p_name_ru), ''), c.name_ru),
      name_en = case when p_name_en is null then c.name_en else nullif(btrim(p_name_en), '') end,
      parent_id = coalesce(p_parent_id, c.parent_id),
      listing_type = coalesce(p_listing_type, c.listing_type),
      domain = coalesce(p_domain, c.domain),
      sort_order = coalesce(p_sort_order, c.sort_order),
      is_active = coalesce(p_is_active, c.is_active),
      icon_key = case when p_icon_key is null then c.icon_key else nullif(btrim(p_icon_key), '') end,
      description = case when p_description is null then c.description else nullif(btrim(p_description), '') end,
      is_selectable = coalesce(p_is_selectable, c.is_selectable),
      disclaimer_text = case when p_disclaimer_text is null then c.disclaimer_text else nullif(btrim(p_disclaimer_text), '') end
    where c.id = p_id
    returning c.id into rid;

    if rid is null then
      raise exception 'listing category not found' using errcode = 'P0001';
    end if;
    return rid;
  end if;

  if p_slug is null or btrim(p_slug) = '' or p_name_ru is null or btrim(p_name_ru) = '' then
    raise exception 'slug and name_ru required for insert' using errcode = 'P0001';
  end if;

  insert into public.listing_categories (
    slug, name_ru, name_en, parent_id, listing_type, domain, sort_order, is_active,
    icon_key, description, is_selectable, disclaimer_text
  )
  values (
    btrim(p_slug),
    btrim(p_name_ru),
    nullif(btrim(coalesce(p_name_en, '')), ''),
    p_parent_id,
    coalesce(p_listing_type, 'marketplace_item'::listing_type),
    coalesce(p_domain, 'marketplace'::listing_domain),
    coalesce(p_sort_order, 0),
    coalesce(p_is_active, true),
    nullif(btrim(coalesce(p_icon_key, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_is_selectable, true),
    nullif(btrim(coalesce(p_disclaimer_text, '')), '')
  )
  on conflict (slug) do update set
    name_ru = excluded.name_ru,
    name_en = coalesce(excluded.name_en, listing_categories.name_en),
    parent_id = coalesce(excluded.parent_id, listing_categories.parent_id),
    listing_type = excluded.listing_type,
    domain = excluded.domain,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    icon_key = coalesce(excluded.icon_key, listing_categories.icon_key),
    description = coalesce(excluded.description, listing_categories.description),
    is_selectable = excluded.is_selectable,
    disclaimer_text = coalesce(excluded.disclaimer_text, listing_categories.disclaimer_text)
  returning id into rid;

  return rid;
end;
$$;

create or replace function public.admin_set_listing_category_active(
  p_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.listing_categories
  set is_active = p_is_active
  where id = p_id;
  if not found then
    raise exception 'listing category not found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_upsert_feature(
  p_id uuid default null,
  p_code text default null,
  p_domains text[] default null,
  p_name_en text default null,
  p_name_ru text default null,
  p_description text default null,
  p_is_active boolean default null,
  p_sort_order integer default null,
  p_verification_status_supported boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rid uuid;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_id is not null then
    update public.platform_features f
    set
      code = coalesce(nullif(btrim(p_code), ''), f.code),
      domains = coalesce(p_domains, f.domains),
      name_en = coalesce(nullif(btrim(p_name_en), ''), f.name_en),
      name_ru = case when p_name_ru is null then f.name_ru else nullif(btrim(p_name_ru), '') end,
      description = case when p_description is null then f.description else nullif(btrim(p_description), '') end,
      is_active = coalesce(p_is_active, f.is_active),
      sort_order = coalesce(p_sort_order, f.sort_order),
      verification_status_supported = coalesce(p_verification_status_supported, f.verification_status_supported)
    where f.id = p_id
    returning f.id into rid;
    if rid is null then
      raise exception 'feature not found' using errcode = 'P0001';
    end if;
    return rid;
  end if;

  if p_code is null or btrim(p_code) = '' or p_name_en is null or btrim(p_name_en) = ''
     or p_domains is null or cardinality(p_domains) < 1 then
    raise exception 'code, name_en, and domains required for insert' using errcode = 'P0001';
  end if;

  insert into public.platform_features (
    code, domains, name_en, name_ru, description, is_active, sort_order, verification_status_supported
  )
  values (
    btrim(p_code),
    p_domains,
    btrim(p_name_en),
    nullif(btrim(coalesce(p_name_ru, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_is_active, true),
    coalesce(p_sort_order, 0),
    coalesce(p_verification_status_supported, false)
  )
  on conflict (code) do update set
    domains = excluded.domains,
    name_en = excluded.name_en,
    name_ru = coalesce(excluded.name_ru, platform_features.name_ru),
    description = coalesce(excluded.description, platform_features.description),
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    verification_status_supported = excluded.verification_status_supported
  returning id into rid;

  return rid;
end;
$$;

create or replace function public.admin_set_language_active(
  p_code text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.platform_languages
  set is_active = p_is_active
  where code = p_code;
  if not found then
    raise exception 'language not found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_set_language_sort(
  p_code text,
  p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.platform_languages
  set sort_order = p_sort_order
  where code = p_code;
  if not found then
    raise exception 'language not found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_set_location_active(
  p_kind text,
  p_id text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  kind text := lower(btrim(p_kind));
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if kind in ('state', 'subdivision') then
    update public.platform_subdivisions
    set is_active = p_is_active
    where code = p_id;
  elsif kind = 'county' then
    update public.platform_counties
    set is_active = p_is_active
    where geoid = p_id;
  elsif kind = 'city' then
    update public.platform_cities
    set is_active = p_is_active
    where geoid = p_id;
  else
    raise exception 'unsupported location kind' using errcode = 'P0001';
  end if;

  if not found then
    raise exception 'location not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_upsert_listing_category(
  uuid, text, text, text, uuid, listing_type, listing_domain, integer, boolean, text, text, boolean, text
) from public, anon;
revoke all on function public.admin_set_listing_category_active(uuid, boolean) from public, anon;
revoke all on function public.admin_upsert_feature(
  uuid, text, text[], text, text, text, boolean, integer, boolean
) from public, anon;
revoke all on function public.admin_set_language_active(text, boolean) from public, anon;
revoke all on function public.admin_set_language_sort(text, integer) from public, anon;
revoke all on function public.admin_set_location_active(text, text, boolean) from public, anon;

grant execute on function public.admin_upsert_listing_category(
  uuid, text, text, text, uuid, listing_type, listing_domain, integer, boolean, text, text, boolean, text
) to authenticated;
grant execute on function public.admin_set_listing_category_active(uuid, boolean) to authenticated;
grant execute on function public.admin_upsert_feature(
  uuid, text, text[], text, text, text, boolean, integer, boolean
) to authenticated;
grant execute on function public.admin_set_language_active(text, boolean) to authenticated;
grant execute on function public.admin_set_language_sort(text, integer) to authenticated;
grant execute on function public.admin_set_location_active(text, text, boolean) to authenticated;
