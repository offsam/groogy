# Аудит атрибуции источника (провенанс карточек)

Дата: 2026-07-30. Данные: живая база (`scripts/sb_sql.py`).
Статус: **исправлено 2026-07-30**, см. раздел «Что сделано» в конце.

Вопрос аудита: почему часть карточек показывает «Источник: КРУГИ», хотя карточка
на самом деле пришла из внешнего справочника (svoi.us и подобные), и почему
ссылки на исходный источник нет в карточках.

## Итог одной строкой

**1868 из 2060 опубликованных бизнесов (91%) показывают «Источник: КРУГИ», хотя
в базе у них лежит рабочая ссылка на внешний источник.** Из них 1855 — на
svoi.us. Ссылка сохранена в `businesses.source_url`, но UI её не показывает.

Пример: `svoi-southampton-spa` → в базе
`https://svoi.us/company/southampton-spa-2758`, на странице — логотип КРУГИ.

## Что в базе

### businesses (approved, 2060)

| `source_kind` | Куда ведёт `source_url` | Карточек | Что видит пользователь |
| --- | --- | --- | --- |
| `platform` | svoi.us | **1855** | «КРУГИ» — неверно |
| `platform` | другие справочники | **11** | «КРУГИ» — неверно |
| `platform` | telegram | **2** | «КРУГИ» — неверно |
| `platform` | ссылки нет | 47 | «КРУГИ» — вероятно верно |
| `telegram` | telegram | 90 | ссылка на пост — верно |
| `facebook` | facebook | 55 | ссылка на пост — верно |

### listings (active, 711)

| `source_kind` | `source_url` | Карточек |
| --- | --- | --- |
| `telegram` | telegram | 510 |
| `facebook` | facebook | 197 |
| `platform` | ссылки нет | 4 |

Директорийных листингов в выдаче нет — проблема здесь пока не проявилась, но код
и схема к ней не готовы (см. раздел 2).

### professionals (approved, 784)

| `source_type` | `source_url` | Карточек | Блок источника |
| --- | --- | --- | --- |
| `TELEGRAM` | telegram | 304 | ссылка на пост |
| `IMPORT` | svoi.us | 199 | «Справочник · Svoi» — верно |
| `FACEBOOK` | facebook | 163 | ссылка на пост |
| `IMPORT` | ссылки нет | **87** | **блок не рендерится вообще** |
| `IMPORT` | telegram | 17 | ссылка на пост |
| `IMPORT` | другие справочники | 10 | «Справочник · …» — верно |
| `IMPORT` | facebook | 3 | ссылка на пост |
| `TELEGRAM` | другие справочники | 1 | «Справочник · …» |

У профессионалов атрибуция справочников работает правильно — единственная
сущность, где это так. Причина в разделе 2.

### jobs и events

- `jobs`: 16 записей с `source_type='IMPORT'` и пустым `source_url`. Блока
  источника у вакансий нет ни в каком виде.
- `events`: 29 записей, у всех `source_url` заполнен (23 facebook, 4 telegram,
  2 platform).

## Причина 1 — скрипт импорта svoi ставит «platform»

Единственный источник всех 1855 карточек:

```801:806:scripts/business-enrich/enrich_svoi_directory.py
        "status": "approved",
        "category_id": category_id,
        "source_url": (rec.get("source_post_urls") or [None])[0],
        "source_kind": "platform",
        "updated_at": now,
    }
```

Скрипт записывает реальный svoi-URL и тем же телом помечает карточку как
созданную на платформе. 1845 карточек залито 27.07.2026, ещё 10 — 28.07.2026.

Дальше каждое звено отображения усиливает ошибку:

1. `resolveSourceUrl()` для platform-источника принципиально возвращает `null` —
   «у платформенных карточек нет внешней ссылки».

```217:223:lib/business/presence.ts
/** External post URL — never for platform-origin cards. */
export function resolveSourceUrl(presence: BusinessPresence): string | null {
  const direct = presence.sourceUrl?.trim() || null;
  if (!direct) return null;
  if (isPlatformSource(presence.sourceKind)) return null;
  return normalizeHttpUrl(direct);
}
```

2. `businesses_public.has_source` для platform равен `true`, поэтому блок
   «Источник» рендерится (а не прячется):

```62:69:supabase/migrations/20260728200000_businesses_public_mention_counts.sql
  (
    coalesce(b.source_kind, '') = 'platform'
    or (
      b.source_url is not null
      and length(btrim(b.source_url)) > 0
      and coalesce(b.source_kind, '') <> 'platform'
    )
  ) as has_source
```

3. `EntitySourceCard` уходит в ветку platform и рисует логотип с надписью
   «КРУГИ» до того, как дело дойдёт до URL:

```139:158:components/shared/EntitySourceCard.tsx
  if (platform) {
    return (
      <section ... id={anchorId}>
        <h2 className="text-sm font-semibold text-slate-900">Источник</h2>
        <div className="mt-2 flex items-center gap-3 rounded-xl px-1 py-1.5">
          <span className={cn(chipClass, "size-8 overflow-hidden p-0.5")}>
            <BrandMark className="size-full" size={28} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
            КРУГИ
          </span>
        </div>
      </section>
    );
  }
```

Отдельно стоит отметить: распознавание справочников в коде уже есть и работает
верно. `isDirectorySourceUrl()` знает про svoi.us, `sourceContactLabel()` вернул
бы «Справочник · Svoi», а `EntitySourceCard:93` автоматически выводит
`kind = "directory"` из URL. До этих строк исполнение просто не доходит —
ветка platform отрабатывает раньше.

## Причина 2 — схема не умеет хранить «справочник»

CHECK-констрейнт на `businesses` и `listings` допускает только три значения:

```15:30:supabase/migrations/20260726220000_businesses_listings_source_provenance.sql
alter table public.businesses
  add constraint businesses_source_kind_check
  check (
    source_kind is null
    or source_kind in ('telegram', 'facebook', 'platform')
  );
```

Значения `directory` нет. Поэтому даже корректный код вынужден выкручиваться —
при апруве рекомендации из справочника пишется `null`:

```906:911:lib/import-review/recommendation-actions.ts
  const sourceKind =
    isDirectory
      ? null
      : item.source_channel === "telegram" || item.source_channel === "facebook"
        ? item.source_channel
        : "platform";
```

У профессионалов та же задача решена иначе и корректно — `professionals_public`
выводит `directory` регуляркой по URL прямо во вью:

```55:71:supabase/migrations/20260728191000_professionals_public_address_directory.sql
  case
    when upper(coalesce(p.source_type, '')) in ('USER', 'ADMIN') then 'platform'
    when p.source_url is not null and length(btrim(p.source_url)) > 0
      and p.source_url ~* 'svoi\.us|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo'
      then 'directory'
    ...
  end as source_kind,
```

Из-за этой асимметрии одна и та же svoi-карточка атрибутируется правильно, если
она специалист, и неправильно, если она бизнес.

## Причина 3 — четыре места, где «platform» подставляется по умолчанию

| Файл | Строки | Условие подстановки |
| --- | --- | --- |
| `lib/import-review/actions.ts` | 1512–1516 | апрув бизнеса без `source_url` |
| `lib/import-review/actions.ts` | 1684–1688 | апрув листинга без `source_url` |
| `lib/admin/move-entity-section.ts` | 599 | `source.sourceKind \|\| "platform"` при переносе в бизнесы |
| `scripts/import-review/autopublish_strong_accepted.py` | 734–737 | `else "platform"` при автопубликации |
| `lib/import-review/recommendation-actions.ts` | 906–911 | всё, что не telegram и не facebook |

В `move-entity-section.ts:599` спрятан ещё и второй дефект. Для профессионала
`sourceKind` берётся как `source_type.toLowerCase()`, то есть даёт `'import'`:

```249:250:lib/admin/move-entity-section.ts
      sourceUrl: data.source_url,
      sourceKind: String(data.source_type || "").toLowerCase(),
```

Значения `'import'` CHECK не допускает — перенос импортированного специалиста в
раздел бизнесов упадёт с нарушением констрейнта. 87 профессионалов с
`source_type='IMPORT'` попадают под этот сценарий.

Там же листинги при переносе не получают `source_kind` вообще
(`move-entity-section.ts:636` копирует только `source_url`), а вакансии и
события жёстко получают `source_type: "IMPORT"` без учёта реального источника.

## Причина 4 — источника нет в карточках списков

Ни один компонент карточки в выдаче не отображает источник: `BusinessCard`,
`ProfessionalCard`, `EventCard`, `JobCard`, `ListingCard`, `ServiceCard`,
`TransferCard`, `LechuCard`, `RealEstateCard`. Источник существует только в
профилях.

Покрытие профилей тоже неполное:

| Сущность | Компонент источника | Есть |
| --- | --- | --- |
| Бизнес | `BusinessSourceCard` → `BusinessProfileSidebar:55` | да |
| Специалист | `ProfessionalSourceCard` → `ProfessionalProfileView:298` | да |
| Маркетплейс / услуги / трансферы / лечу | `ListingSourceCard` | да |
| Событие | `EntitySourceCard` внутри блока «Контакты» | да, но не отдельной секцией |
| **Вакансия** | — | **нет** |
| **Недвижимость** | — | **нет** |

Дополнительно `ProfessionalSourceCard` возвращает `null`, когда `hasSource`
ложно, — те самые 87 профессионалов остаются вообще без блока источника.

## Причина 5 — гость не видит, что источник внешний

`stripBusinessContacts` (`lib/supabase/mappers.ts:210–211`) обнуляет
неплатформенный `sourceKind` для неавторизованных. Гость видит кнопку «Показать
источник» без указания, куда она ведёт, — но для platform-карточек `sourceKind`
сохраняется, и надпись «КРУГИ» показывается всем без ограничений. То есть
неверная атрибуция видна публично, а верная спрятана за авторизацией.

## Правило атрибуции

«КРУГИ» показывается только тогда, когда карточка действительно создана у нас и
внешней ссылки нет. Всё остальное — реальный источник со ссылкой либо честное
молчание, но никогда не ложное присвоение.

| Условие | Что показываем |
| --- | --- |
| Создано вручную / владельцем, `source_url` пустой | КРУГИ |
| URL на svoi / Orange Pages / To4ka и т. п. | «Справочник · Svoi» + ссылка |
| URL на Telegram / Facebook | Ссылка на оригинальный пост |
| Внешний URL на незнакомом хосте | Ссылка с подписью по хосту |
| Импорт есть, URL потерян | Блок не показывается — но и КРУГИ не пишем |

## Что сделано

### Схема

`supabase/migrations/20260730173000_source_kind_directory.sql` — значение
`directory` добавлено в CHECK для `businesses` и `listings`. Применено.

`businesses_public` не трогали: профиль читает `source_kind`/`source_url`
напрямую из таблицы через `lib/supabase/queries.ts`, а `has_source` после
бэкфилла считается корректно и без изменений.

### Один классификатор вместо шести

`resolveSourceKind(sourceUrl, rawSource)` и `sourceTypeFromKind(kind)` в
`lib/business/presence.ts`, зеркальная копия для скриптов —
`scripts/import-review/source_kind.py`. URL всегда важнее текстовой подсказки, а
неопределённое происхождение остаётся `null`, а не превращается в `platform`.

На них переведены все пути публикации:

| Файл | Было |
| --- | --- |
| `scripts/business-enrich/enrich_svoi_directory.py` | хардкод `"platform"` — корень проблемы |
| `lib/import-review/actions.ts` (бизнес, листинг, специалист, вакансия) | фолбэк на `platform` / `TELEGRAM` |
| `lib/import-review/recommendation-actions.ts` | `null` для справочников, `platform` для остального |
| `lib/admin/move-entity-section.ts` | `sourceKind \|\| "platform"` + `'import'`, ломавший CHECK |
| `scripts/import-review/autopublish_strong_accepted.py` | `else "platform"` |
| `scripts/business-enrich/publish_recommendation_catalog.py` | `else "platform"` |
| `scripts/business-enrich/professional_cleanup_phase2.py` | `return "platform"` |
| `scripts/business-enrich/move_pros_to_lechu_transfers.py` | `return "platform"` |

Заодно закрылся баг переноса разделов: `source_type` специалиста больше не
пишется в `businesses.source_kind` как `'import'`, а листинги при переносе
получают `source_kind`.

### UI

`isPlatformOrigin()` заменил `isPlatformSource()` в четырёх компонентах
(`EntitySourceCard`, `BusinessSourceCard`, `ListingSourceCard`,
`ProfessionalSourceCard`): ветка КРУГИ теперь требует и `kind === "platform"`,
и пустой `source_url`. `resolveSourceUrl()` больше не обнуляет ссылку для
platform-карточек, а `sourceContactLabel()` не подписывает ссылку как КРУГИ.
Если такая пара снова появится в базе, UI покажет ссылку, а не присвоит карточку.

### Данные

`scripts/business-enrich/backfill_source_attribution.py` (по умолчанию dry-run).
Прогон 2026-07-30: **1870 бизнесов** переклассифицировано — 1868 в `directory`,
2 в `telegram`. Листинги были чисты. Вторым прогоном исправлены **2 события** с
`source_channel='platform'` и ссылкой на Telegram-пост. Отчёты:
`docs/audits/data/source_attribution_{dry,apply}_latest.json`.

По хостам ложное «КРУГИ» распределилось так: 1857 svoi.us, 11 Russian Orange
Pages, 2 прямые ссылки на Telegram. То есть механизм задевал любой источник —
svoi просто залили самым большим пакетом за один прогон 27 июля.

Специалисты (784 карточки, из них 221 из справочников) не пострадали: их вью
выводит источник из URL, а не из хранимого поля. Вакансии и листинги были чисты.

Распределение по опубликованным бизнесам после бэкфилла:

| `source_kind` | Куда ведёт URL | Карточек |
| --- | --- | --- |
| `directory` | svoi.us | 1855 |
| `telegram` | telegram | 92 |
| `facebook` | facebook | 55 |
| `platform` | ссылки нет | 47 |
| `directory` | другие справочники | 11 |

`platform` остался только там, где внешней ссылки действительно нет.

### Защита от регресса

`scripts/business-enrich/audit_source_attribution.py` — падает с кодом 1, если
находит карточку с платформенной атрибуцией и внешней ссылкой (проверяет
businesses, listings, professionals, jobs, events). Сейчас проходит чисто.

`external_source` у событий сознательно оставлен как есть: он входит в
уникальный индекс `(external_source, external_id)` и работает ключом
дедупликации, а не атрибуцией. Провенанс события теперь живёт в
`source_channel`.

## Что осталось за рамками

Сознательно не делали, требуется продуктовое решение:

- **Источник в карточках списков.** По-прежнему нигде не показывается. Нужно
  решить, что именно выводить — бейдж «Справочник», иконку или ничего.
- **Вакансии и недвижимость** без блока источника в профиле. Для вакансий поля
  `source_url`/`source_type` вообще не доходят до слоя приложения.
- **87 профессионалов с `IMPORT` и пустым URL** — блок не рендерится. Ложной
  атрибуции нет, но пользователь не понимает, откуда карточка.
