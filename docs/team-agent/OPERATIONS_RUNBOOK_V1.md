# Как проверить Team Agent

## Telegram

Бот: `@kroogy_bot`. Группа Kroogy, chat id `-5339548898`.

Webhook должен указывать на Preview feature branch, не на `www.kroogy.com`.

Проверка без секретов: `npm run team-agent:telegram:status`.

Живой ответ: `/agent status` в группе.

## OpenRouter

Переменные только на сервере: `OPENROUTER_API_KEY`, `TEAM_AGENT_PROVIDER=openrouter`, `TEAM_AGENT_MODEL=deepseek/deepseek-v4-flash`.

Обычное сообщение не вызывает модель. Позовёте бота — один запрос. Повтор той же доставки Telegram второй раз модель не вызывает.

Ошибка 402 различается: нет денег, лимит ключа или неясный биллинг. Повторного платного запроса при 402 нет.

Автоматически баланс не пополняется.

## GitHub

Нужен отдельный токен только на чтение: Contents, Pull requests, Metadata. Checks по возможности. Без записи и без личного пароля.

- `GITHUB_TEAM_AGENT_TOKEN`
- `GITHUB_TEAM_AGENT_REPO=owner/name`

На Vercel их нет — бот честно пишет, что GitHub не подключён. Preview не читает локальный `.git`.

## База

Запись идёт в таблицы `team_agent_*` через service role. Новая migration для этого этапа не нужна.

Подтверждение задачи: `/agent approve <id>` от известного участника.

## Preview

Деплой только Preview ветки `team-agent/telegram-webhook-v1`. Production и `main` не трогать. Webhook на production не переключать.

## Если бот ответил про ошибку AI

В логе Vercel ищите `[team-agent]` и короткий код. Секреты туда не пишутся. Человеку stack trace не показывается.
