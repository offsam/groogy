# Задание: SQL в Supabase для событий (address_line)

**Проект:** Круги / groogy  
**Файл SQL:** `docs/plans/FIX_EVENTS_COLUMNS.sql`

---

## Что сделать

1. Открой `docs/plans/FIX_EVENTS_COLUMNS.sql`.
2. Выполни весь SQL в **Supabase → SQL Editor → Run**  
   (проект из `.env.local` → `NEXT_PUBLIC_SUPABASE_URL`, ref вида `….supabase.co`).  
   Прямая ссылка-пример: https://supabase.com/dashboard/project/zmsbosigfmnmyavuhlyb/sql/new
3. Дождись **Success**.
4. Если колонки уже есть — это нормально (`if not exists`).

SQL добавляет в `public.events`: `address_line`, `price_label`, `phone`, `telegram_url`, `venue_name`, политику `events owner select`, и `notify pgrst, 'reload schema'`.

---

## Чего не делать

- Не запускай сайт локально и ничего не проверяй в браузере.
- Не читай и не свети секреты из `.env` / `.env.local`.
- Не коммить и не мержи в `main`.

---

## Отчёт (простым русским)

Напиши коротко:

1. SQL выполнен или нет.  
2. Было Success или текст ошибки.  
3. Если ошибка — что помешало.
