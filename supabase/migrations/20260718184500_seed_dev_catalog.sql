-- Migration: seed_dev_catalog
-- Dev seed: активные категории и 10 тестовых бизнесов Orange County.
-- Рейтинги и отзывы НЕ заполняются (rating_avg = 0, reviews_count = 0).
-- НЕ применять без отдельного подтверждения.

-- Фиксированные UUID, чтобы бизнесы стабильно ссылались на категории.
-- Повторный запуск безопасен за счёт ON CONFLICT.

insert into categories (id, slug, name, icon, sort_order, is_active) values
  ('a1000001-0000-4000-8000-000000000001', 'restaurants',  'Рестораны',               'restaurants',  10, true),
  ('a1000001-0000-4000-8000-000000000002', 'groceries',    'Продукты',                 'groceries',    20, true),
  ('a1000001-0000-4000-8000-000000000003', 'beauty',       'Красота',                  'beauty',       30, true),
  ('a1000001-0000-4000-8000-000000000004', 'auto',         'Автосервис',               'auto',         40, true),
  ('a1000001-0000-4000-8000-000000000005', 'medical',      'Медицина',                 'medical',      50, true),
  ('a1000001-0000-4000-8000-000000000006', 'legal',        'Юристы',                   'legal',        60, true),
  ('a1000001-0000-4000-8000-000000000007', 'education',    'Образование',              'education',    70, true),
  ('a1000001-0000-4000-8000-000000000008', 'services',     'Услуги',                   'services',     80, true),
  ('a1000001-0000-4000-8000-000000000009', 'real_estate',  'Недвижимость',             'real_estate',  90, true),
  ('a1000001-0000-4000-8000-00000000000a', 'fitness',      'Спорт и фитнес',           'fitness',     100, true),
  ('a1000001-0000-4000-8000-00000000000b', 'pets',         'Животные',                 'pets',        110, true),
  ('a1000001-0000-4000-8000-00000000000c', 'finance',      'Финансы и бухгалтерия',    'finance',     120, true),
  ('a1000001-0000-4000-8000-00000000000d', 'insurance',    'Страхование',              'insurance',   130, true),
  ('a1000001-0000-4000-8000-00000000000e', 'travel',       'Путешествия',              'travel',      140, true),
  ('a1000001-0000-4000-8000-00000000000f', 'events',       'Мероприятия',              'events',      150, true)
on conflict (slug) do update set
  name = excluded.name,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into businesses (
  id, slug, category_id, name, short_description, description, status,
  rating_avg, reviews_count, phone, website, image_url,
  address_line, city, region, latitude, longitude
) values
  (
    'b1000001-0000-4000-8000-000000000001',
    'kalinka-restaurant',
    'a1000001-0000-4000-8000-000000000001',
    'Ресторан «Калинка»',
    'Домашняя русская кухня',
    'Домашняя русская кухня: борщ, пельмени, блины. Банкеты и живая музыка по выходным.',
    'approved', 0, 0,
    '(949) 555-0121', 'https://kalinka-oc.example.com', '/images/categories/restaurants.svg',
    '4250 Barranca Pkwy', 'Irvine', 'CA', 33.6595, -117.8103
  ),
  (
    'b1000001-0000-4000-8000-000000000002',
    'samovar-cafe',
    'a1000001-0000-4000-8000-000000000001',
    'Кафе «Самовар»',
    'Чай и домашняя выпечка',
    'Уютное кафе с домашней выпечкой, сырниками и настоящим чаем из самовара.',
    'approved', 0, 0,
    '(949) 555-0177', 'https://samovar-cafe.example.com', '/images/categories/restaurants.svg',
    '17595 Harvard Ave', 'Irvine', 'CA', 33.7015, -117.8402
  ),
  (
    'b1000001-0000-4000-8000-000000000003',
    'beryozka-market',
    'a1000001-0000-4000-8000-000000000002',
    'Магазин «Берёзка»',
    'Русские и европейские продукты',
    'Русские и европейские продукты: колбасы, сыры, конфеты, гречка и квас.',
    'approved', 0, 0,
    '(714) 555-0195', 'https://beryozka-market.example.com', '/images/categories/groceries.svg',
    '18930 Brookhurst St', 'Fountain Valley', 'CA', 33.7092, -117.9536
  ),
  (
    'b1000001-0000-4000-8000-000000000004',
    'anna-beauty-salon',
    'a1000001-0000-4000-8000-000000000003',
    'Салон красоты «Анна»',
    'Стрижки, окрашивание, маникюр',
    'Стрижки, окрашивание, маникюр и брови. Мастера с европейским образованием.',
    'approved', 0, 0,
    '(949) 555-0134', 'https://anna-beauty.example.com', '/images/categories/beauty.svg',
    '3851 Birch St', 'Newport Beach', 'CA', 33.6634, -117.8674
  ),
  (
    'b1000001-0000-4000-8000-000000000005',
    'master-auto-service',
    'a1000001-0000-4000-8000-000000000004',
    'Автосервис «Мастер»',
    'Диагностика и ремонт',
    'Диагностика, ремонт двигателя и ходовой. Честные цены, гарантия на работы.',
    'approved', 0, 0,
    '(714) 555-0112', 'https://master-auto.example.com', '/images/categories/auto.svg',
    '1240 N Kraemer Blvd', 'Anaheim', 'CA', 33.8478, -117.8759
  ),
  (
    'b1000001-0000-4000-8000-000000000006',
    'dr-ivanov-dental',
    'a1000001-0000-4000-8000-000000000005',
    'Стоматология Dr. Ivanov',
    'Семейная стоматология',
    'Семейная стоматология: лечение, имплантация, отбеливание. Принимаем страховки.',
    'approved', 0, 0,
    '(714) 555-0129', 'https://ivanov-dental.example.com', '/images/categories/medical.svg',
    '14501 Newport Ave', 'Tustin', 'CA', 33.7365, -117.8129
  ),
  (
    'b1000001-0000-4000-8000-000000000007',
    'smirnova-law',
    'a1000001-0000-4000-8000-000000000006',
    'Адвокат Елена Смирнова',
    'Иммиграционное и семейное право',
    'Иммиграционное и семейное право. Грин-карты, визы, гражданство. Консультации на русском.',
    'approved', 0, 0,
    '(949) 555-0163', 'https://smirnova-law.example.com', '/images/categories/legal.svg',
    '620 Newport Center Dr', 'Newport Beach', 'CA', 33.6151, -117.8752
  ),
  (
    'b1000001-0000-4000-8000-000000000008',
    'znanie-school',
    'a1000001-0000-4000-8000-000000000007',
    'Русская школа «Знание»',
    'Русский язык и математика для детей',
    'Русский язык, математика и шахматы для детей от 4 до 14 лет. Занятия по субботам.',
    'approved', 0, 0,
    '(949) 555-0108', 'https://znanie-school.example.com', '/images/categories/education.svg',
    '1 Federation Way', 'Irvine', 'CA', 33.6537, -117.7443
  ),
  (
    'b1000001-0000-4000-8000-000000000009',
    'domovoy-remont',
    'a1000001-0000-4000-8000-000000000008',
    'Ремонтная компания «Домовой»',
    'Ремонт квартир под ключ',
    'Ремонт квартир и домов под ключ: электрика, сантехника, покраска, полы.',
    'approved', 0, 0,
    '(714) 555-0174', 'https://domovoy-remont.example.com', '/images/categories/services.svg',
    '5405 Garden Grove Blvd', 'Westminster', 'CA', 33.7743, -117.994
  ),
  (
    'b1000001-0000-4000-8000-000000000010',
    'elegance-spa',
    'a1000001-0000-4000-8000-000000000003',
    'Elegance SPA',
    'Массаж и косметология',
    'Массаж, косметология и уход за лицом. Русскоговорящие специалисты.',
    'approved', 0, 0,
    '(949) 555-0189', 'https://elegance-spa.example.com', '/images/categories/beauty.svg',
    '24012 Avenida de la Carlota', 'Laguna Hills', 'CA', 33.6103, -117.7098
  )
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  short_description = excluded.short_description,
  description = excluded.description,
  status = excluded.status,
  phone = excluded.phone,
  website = excluded.website,
  image_url = excluded.image_url,
  address_line = excluded.address_line,
  city = excluded.city,
  region = excluded.region,
  latitude = excluded.latitude,
  longitude = excluded.longitude;
  -- rating_avg / reviews_count намеренно не трогаем при повторном seed,
  -- чтобы не затирать реальные значения, если они появятся позже.
