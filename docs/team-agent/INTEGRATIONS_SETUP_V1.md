# Подключение источников Team Agent

Секреты добавляет владелец в Vercel Preview. Их не нужно присылать в чат. Пока переменной нет, бот пишет «не подключено» и не подставляет выдуманные SHA.

## GitHub

1. Создайте token с правом Read: Contents, Pull requests, Metadata. Checks — Read, если нужны статусы. Write не нужен.
2. Preview env: `GITHUB_TEAM_AGENT_TOKEN`, `GITHUB_TEAM_AGENT_REPO=offsam/groogy`.
3. Для webhook: `GITHUB_TEAM_AGENT_WEBHOOK_SECRET` — случайная строка, не token GitHub.
4. В GitHub откройте Settings → Webhooks. URL: `https://groogy-git-team-agent-telegram-webhook-v1-offsams-projects.vercel.app/api/webhooks/team-agent-github`. Content type: `application/json`. Secret — то же значение. События: push, pull request, pull request review, check run, check suite, workflow run, delete. Агент сам этот webhook не создаёт.
5. После добавления env нужен новый Preview deploy.

## Vercel

1. Создайте token и используйте его только для чтения. Этот агент вызывает только список deployments.
2. Preview env: `VERCEL_TEAM_AGENT_TOKEN`, `VERCEL_PROJECT_ID`, при команде проекта ещё `VERCEL_TEAM_ID`.
3. Project ID уже существующего проекта Kroogy. Второй проект создавать не нужно.

## Supabase

1. Запись Team Agent уже идёт через `SUPABASE_SERVICE_ROLE_KEY` на сервере. Этот ключ в Telegram и в модель не передаётся.
2. Чтобы видеть историю миграций, нужен другой ключ: personal access token Supabase и `SUPABASE_PROJECT_REF`. Это не service_role.
3. Файлы из `supabase/migrations` сравниваются с этой историей по номеру версии. Одинаковые имена не доказывают, что схема совпала.
4. Migration `20260925181702_team_agent_control_center_v1.sql` подготовлена и не применена. Её применяет только владелец отдельным решением.

## Cursor

1. Придумайте `TEAM_AGENT_REPORTER_TOKEN` и положите его в Preview.
2. На своём компьютере задайте тот же token, `TEAM_AGENT_REPORTER_URL` на `https://…/api/team-agent/local-report` и свой `TEAM_AGENT_REPORTER_MEMBER_ID` из таблицы участников.
3. Команда: `npx tsx scripts/team-agent-local-report.ts`.
4. Без этой команды агент пишет «локальное состояние неизвестно», а не «работы нет».

## Сверка

`POST /api/team-agent/reconcile` с заголовком `Authorization: Bearer` и значением `TEAM_AGENT_RECONCILE_SECRET`. Вызов читает источники и не вызывает модель. Часовой cron в проект не добавлен: его нужно включить отдельно, если план Vercel это позволяет.
