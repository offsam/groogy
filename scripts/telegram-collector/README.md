# Telegram MTProto collector (Telethon)

Подключение обычного Telegram-аккаунта через **Telethon** (MTProto), не Bot API.
На этом этапе только авторизация и проверка доступа к группам/каналам.

> **Private machine runbook** (gitignored): `.local/collectors/TELEGRAM_RUNBOOK.md`  
> Wrappers: `.local/collectors/bin/tg-estimate.sh` / `tg-confirm-run.sh`

## Требования

В корне проекта (`.env` или `.env.local`):

```
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
TELEGRAM_PHONE=+1...
```

Секреты не выводятся в консоль. Session-файл и `.env*` не коммитятся в Git.

## Установка

```bash
cd scripts/telegram-collector
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Авторизация

При первом запуске Telegram пришлёт код в приложение. При включённой 2FA скрипт запросит пароль.

```bash
cd scripts/telegram-collector
source .venv/bin/activate
python auth.py
```

Неинтерактивно (код не логируется скриптом):

```bash
python auth.py --code 12345
# при 2FA:
python auth.py --code 12345 --password 'your-2fa-password'
```

После успеха выводятся только имя аккаунта и user id. Session сохраняется в `telegram_business.session`.

## Список групп и каналов

```bash
cd scripts/telegram-collector
source .venv/bin/activate
python list_dialogs.py
```

Для каждого диалога: title, id, username (если есть), тип (`group` / `supergroup` / `channel`).

## Сбор и анализ (Fun for Mom)

```bash
cd scripts/telegram-collector
source .venv/bin/activate
python collect_messages.py --chat-id -1001333533747 --limit 200
TELEGRAM_ANALYZER_MODE=llm python analyze_business_posts.py --prefix fun_for_mom_v2
```

`TELEGRAM_ANALYZER_MODE`:
- `llm` — OpenRouter / OpenAI / Anthropic (нужен ключ в `.env.local`)
- `rule_based` — эвристики (временный режим)

Результаты в `data/` (gitignored). В Supabase ничего не пишется.
Рекомендации третьих лиц никогда не auto-accepted.
