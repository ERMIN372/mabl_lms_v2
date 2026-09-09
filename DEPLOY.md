# Перенос МАБЛ LMS с Vercel на VM Yandex Cloud

Пошаговая инструкция: что нажать в консоли Yandex Cloud и какие команды выполнить
на сервере. Все команды проверяемые — после каждого блока указано, как убедиться,
что шаг сработал.

**Целевая архитектура:**

| Слой | Было (Vercel) | Стало (Yandex Cloud) |
|---|---|---|
| Фронтенд | CDN Vercel | статика `dist/`, раздаёт nginx на VM |
| API | serverless-функции `api/*` | один процесс Node (Express) на порту 3000, systemd |
| База | Neon (HTTP-драйвер) | Managed Service for PostgreSQL, драйвер `pg` |
| Файлы | Vercel Blob | Object Storage (S3), приватный бакет |
| Маршруты | `vercel.json` → rewrites | nginx + `server/index.ts` |
| Cron | Vercel Crons | systemd-таймер `mabl-news-sync.timer` |

Термины: **VM** (virtual machine, виртуальная машина) — арендованный сервер;
**Object Storage** — файловое хранилище, совместимое с протоколом S3;
**systemd** — стандартный менеджер сервисов Linux, следит, чтобы приложение
работало и перезапускалось после сбоя.

---

## 0. Что нужно приготовить заранее

1. Доступ к консоли Yandex Cloud с правами на создание ресурсов.
2. SSH-доступ к VM (у вас уже есть):
   ```powershell
   ssh -i "%USERPROFILE%\.ssh\ssh-key-1787832426561-hr-ai-01" user-hr@37.230.169.206
   ```
3. Доступ к проекту на Vercel — оттуда нужно забрать **секреты** и **дамп базы**.
4. Домен, который сейчас указывает на Vercel, и доступ к его DNS-записям.

### 0.1. Забрать секреты с Vercel (до отключения проекта!)

Vercel → проект → Settings → Environment Variables. Выпишите значения:

| Переменная | Зачем |
|---|---|
| `AUTH_SECRET` | подпись токенов сессий. Если потерять — **все пользователи разлогинятся** |
| `DATABASE_URL` | строка подключения к Neon, нужна для дампа |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | боевая оплата |
| `TELEGRAM_CHANNEL` | импорт новостей |
| `SETUP_SECRET` | инициализация БД |
| `ADMIN_EMAIL` | стартовый администратор |

### 0.2. Снять дамп базы Neon

На своей машине (или на VM — тогда сначала `sudo apt install -y postgresql-client-16`):

```bash
pg_dump "postgres://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@ХОСТ.neon.tech/ИМЯ_БД?sslmode=require" \
  --format=custom --no-owner --no-privileges --file=mabl-neon.dump
```

Проверка: `ls -lh mabl-neon.dump` — файл не должен быть пустым.

---

## 1. Managed Service for PostgreSQL

Консоль YC → **Managed Service for PostgreSQL** → «Создать кластер».

| Параметр | Значение |
|---|---|
| Имя кластера | `mabl-lms-db` |
| Версия | PostgreSQL 16 |
| Класс хоста | s3-c2-m8 (2 vCPU, 8 ГБ) или меньше — `b2.medium` для старта |
| Размер хранилища | 20 ГБ, network-ssd |
| Сеть | **та же, что у VM** (VM смотрит в подсеть с адресом 10.129.0.12) |
| Зона доступности | та же, что у VM |
| Имя БД | `mabl` |
| Пользователь | `mabl`, пароль — сгенерировать длинный |
| Публичный доступ к хосту | выключен (VM ходит по внутренней сети) |
| Резервное копирование | включено, срок 7–30 дней |

После создания: кластер → **Хосты** → скопируйте FQDN вида
`rc1a-xxxxxxxxxxxx.mdb.yandexcloud.net`. Порт — **6432**.

Разрешите VM ходить в кластер: в группе безопасности кластера должно быть
правило «входящий TCP 6432 из подсети VM» (или из группы безопасности VM).

---

## 2. Файловое хранилище

Файлы SCORM-пакетов и вложения материалов лежат вне базы. Есть два режима —
выберите один.

### Вариант A: диск сервера (по умолчанию)

Ничего создавать в облаке не нужно, права в консоли не требуются:

```bash
sudo mkdir -p /var/lib/mabl-lms/files
sudo chown user-hr:user-hr /var/lib/mabl-lms/files
```

В `/etc/mabl-lms.env` задаётся `STORAGE_DIR=/var/lib/mabl-lms/files`.

Подходит, когда объём файлов измеряется десятками гигабайт — то есть почти
всегда для одной академии. Минус один: файлы живут на диске виртуальной машины,
поэтому их надо включить в резервное копирование (см. раздел 13) и перенести
руками при пересоздании машины.

### Вариант B: Yandex Object Storage

Нужен, если файлы должны пережить машину сами по себе или их станет очень много.
Требует прав в консоли облака.

1. **Object Storage** → «Создать бакет»: имя `mabl-lms-files` (глобально
   уникальное), доступ на чтение объектов — **закрытый**: наружу файлы отдаёт
   приложение, публичность бакета не нужна.
2. **Сервисные аккаунты** → «Создать»: имя `mabl-lms-storage`, роль
   `storage.editor`.
3. Открыть аккаунт → «Создать новый ключ» → **статический ключ доступа**.
   Сохраните `key_id` и `secret` — секрет показывается один раз.

В `/etc/mabl-lms.env` задаются `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, а `STORAGE_DIR` остаётся пустым: если задан каталог,
приоритет у диска.

> Ключи объектов в обоих режимах одинаковые (`scorm/<id>/<путь>`,
> `materials/<имя>`), поэтому переезд с диска в бакет и обратно — это простое
> копирование файлов с сохранением путей.

## 3. Подготовка VM

Подключитесь к серверу и выполните:

```bash
# --- системные обновления и базовые пакеты ---
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx postgresql-client-16

# --- Node.js 22 LTS ---
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v      # ожидаем v22.x и 10.x

# --- корневой сертификат Яндекса для TLS-подключения к БД ---
sudo mkdir -p /etc/ssl/certs
sudo curl -fsSL https://storage.yandexcloud.net/cloud-certs/CA.pem \
  -o /etc/ssl/certs/yandex-root.crt
sudo chmod 644 /etc/ssl/certs/yandex-root.crt
```

Проверка Node: `node -v` печатает `v22.*`.

### 3.1. Код с GitHub

```bash
sudo mkdir -p /srv/mabl-lms
sudo chown user-hr:user-hr /srv/mabl-lms
git clone https://github.com/HR-analyze/mabl_lms_v2.git /srv/mabl-lms
cd /srv/mabl-lms
git checkout main         # или ветку миграции, пока PR не влит
npm ci
```

Проверка: `ls /srv/mabl-lms/server/index.ts` — файл существует.

---

## 4. Переменные окружения

```bash
sudo cp /srv/mabl-lms/deploy/mabl-lms.env.example /etc/mabl-lms.env
sudo chmod 600 /etc/mabl-lms.env
sudo nano /etc/mabl-lms.env
```

Заполните:

- `DATABASE_URL` — `postgresql://mabl:ПАРОЛЬ@rc1a-xxxx.mdb.yandexcloud.net:6432/mabl?sslmode=verify-full`
- `DATABASE_CA_FILE=/etc/ssl/certs/yandex-root.crt`
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — из шага 2
- `AUTH_SECRET` — **тот же, что был на Vercel** (иначе слетят сессии)
- `YOOKASSA_*`, `TELEGRAM_CHANNEL`, `ADMIN_EMAIL`, `SETUP_SECRET` — из шага 0.1

Проверка подключения к БД:

```bash
set -a; . /etc/mabl-lms.env; set +a
psql "$DATABASE_URL" -c "SELECT version();"
```

Должна напечататься версия PostgreSQL. Если висит без ответа — не открыт порт
6432 в группе безопасности кластера.

---

## 5. Перенос данных

```bash
cd ~
# файл mabl-neon.dump скопируйте на VM, например через scp с локальной машины:
#   scp -i "%USERPROFILE%\.ssh\ssh-key-..." mabl-neon.dump user-hr@37.230.169.206:~/

set -a; . /etc/mabl-lms.env; set +a
pg_restore --dbname="$DATABASE_URL" --no-owner --no-privileges --clean --if-exists \
  --verbose mabl-neon.dump
```

Проверка — таблицы и количество строк:

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT collection, count(*) FROM content GROUP BY collection ORDER BY 1;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
```

Ожидаем таблицы `courses`, `users`, `news`, `news_comments`, `news_reactions`,
`participants`, `orders`, `content`.

> Если дампа нет и база создаётся с нуля — пропустите этот шаг: приложение само
> создаст схему при первом запуске (`POST /api/setup?secret=$SETUP_SECRET`).

---

## 6. Сборка и запуск сервиса

```bash
cd /srv/mabl-lms
npm run build            # собирает фронтенд (dist/) и сервер (dist-server/)

sudo cp deploy/mabl-lms.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mabl-lms
sudo systemctl status mabl-lms --no-pager
```

Проверка:

```bash
curl -s http://127.0.0.1:3000/healthz        # {"ok":true,"uptime":...}
curl -s http://127.0.0.1:3000/api/courses | head -c 300
```

Логи в реальном времени: `journalctl -u mabl-lms -f`

---

## 7. Перенос файлов из Vercel Blob

Скрипт читает адреса файлов из БД, скачивает их с Vercel и кладёт в бакет,
после чего переписывает адреса на `/files/...`. Сначала — пробный прогон:

```bash
cd /srv/mabl-lms
set -a; . /etc/mabl-lms.env; set +a
node scripts/migrate-blob-to-s3.mjs --dry-run
```

Если план выглядит верно — перенос:

```bash
node scripts/migrate-blob-to-s3.mjs
```

Скрипт идемпотентен: повторный запуск пропускает уже перенесённое.

> **Важно:** он работает, пока проект на Vercel ещё жив и файлы доступны по
> старым ссылкам. Делайте это ДО отключения Vercel. Если Blob был приватным и
> скачивание отдаёт 403, единственный путь — перезалить SCORM-пакеты через
> админку после переезда.

Проверка: `curl -sI http://127.0.0.1:3000/scorm-store/<id-пакета>/index.html`
— ожидаем `HTTP/1.1 200`.

---

## 8. nginx и TLS

```bash
sudo cp /srv/mabl-lms/deploy/nginx-mabl-lms.conf /etc/nginx/sites-available/mabl-lms
sudo nano /etc/nginx/sites-available/mabl-lms      # подставить свой домен в server_name
sudo ln -sf /etc/nginx/sites-available/mabl-lms /etc/nginx/sites-enabled/mabl-lms
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Проверка по IP (до переключения DNS):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://37.230.169.206/
curl -s http://37.230.169.206/healthz
```

Сертификат Let's Encrypt (после того, как домен начнёт указывать на VM):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mabl.ru -d www.mabl.ru
sudo systemctl status certbot.timer     # автопродление
```

> Certificate Manager Яндекса здесь не подходит: он выдаёт сертификаты для
> Application Load Balancer и CDN, а не для nginx на «голой» VM.

---

## 9. Ежедневная синхронизация новостей (замена Vercel Cron)

```bash
sudo cp /srv/mabl-lms/deploy/mabl-news-sync.service /etc/systemd/system/
sudo cp /srv/mabl-lms/deploy/mabl-news-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mabl-news-sync.timer
systemctl list-timers mabl-news-sync.timer --no-pager
```

Проверка вручную: `sudo systemctl start mabl-news-sync && journalctl -u mabl-news-sync -n 20`

Отдельно убедитесь, что с VM вообще доступен Telegram:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://t.me/s/mabl_academy
```

Если код не 200 — импорт новостей работать не будет; это ограничение сети, а не кода.

---

## 10. Приёмочная проверка перед переключением DNS

Проверяйте по IP или временному поддомену:

- [ ] Главная открывается, стили и шрифты на месте
- [ ] Вход администратора работает (тем же паролем — если `AUTH_SECRET` перенесён)
- [ ] Список программ, новости, материалы отображаются из БД
- [ ] SCORM-курс открывается и **отмечает прогресс** (проверка same-origin)
- [ ] Файл материала скачивается по ссылке `/files/...`
- [ ] Загрузка нового SCORM-пакета через админку проходит до конца
- [ ] Заявка со страницы программы создаётся (`POST /api/applications`)
- [ ] `journalctl -u mabl-lms -n 100` — без ошибок

---

## 11. Переключение домена и ЮKassa

1. **За сутки** снизьте TTL DNS-записи до 300 секунд.
2. Смените A-запись домена на `37.230.169.206`, удалите CNAME на Vercel.
3. Дождитесь распространения: `dig +short mabl.ru`
4. Выпустите TLS-сертификат (шаг 8).
5. **ЮKassa** → Личный кабинет → Магазин → Интеграция → HTTP-уведомления:
   поменяйте URL вебхука на `https://mabl.ru/api/payments/webhook`.
6. Проведите **боевой платёж на минимальную сумму** и убедитесь, что заказ
   перешёл в статус «оплачен».
7. Проект на Vercel не удаляйте ещё неделю — это ваш путь отката.

---

## 12. Обновление кода в дальнейшем

Код по-прежнему живёт на GitHub. Деплой — одна команда на сервере:

```bash
cd /srv/mabl-lms && ./deploy/deploy.sh main
```

Скрипт забирает ветку, ставит зависимости, собирает и перезапускает сервис,
после чего ждёт ответа от `/healthz`.

---

## 13. Резервные копии

**База.** Автоматические бэкапы включены на стороне Managed PostgreSQL
(кластер → «Резервные копии»). Дополнительный локальный дамп по расписанию:

```bash
sudo tee /etc/cron.daily/mabl-db-dump >/dev/null <<'SH'
#!/bin/sh
set -a; . /etc/mabl-lms.env; set +a
mkdir -p /var/backups/mabl
pg_dump "$DATABASE_URL" --format=custom \
  --file="/var/backups/mabl/mabl-$(date +%F).dump"
find /var/backups/mabl -name 'mabl-*.dump' -mtime +14 -delete
SH
sudo chmod +x /etc/cron.daily/mabl-db-dump
```

**Файлы.** При хранении на диске (`STORAGE_DIR`) резервная копия — обычный архив
каталога по расписанию:

```bash
sudo tee /etc/cron.daily/mabl-files-backup >/dev/null <<'SH'
#!/bin/sh
set -a; . /etc/mabl-lms.env; set +a
[ -n "$STORAGE_DIR" ] || exit 0
mkdir -p /var/backups/mabl
tar -czf "/var/backups/mabl/files-$(date +%F).tar.gz" -C "$STORAGE_DIR" .
find /var/backups/mabl -name 'files-*.tar.gz' -mtime +14 -delete
SH
sudo chmod +x /etc/cron.daily/mabl-files-backup
```

При хранении в Object Storage данные лежат с тройной репликацией, но от
ошибочного удаления это не спасает — включите версионирование бакета.

---

## 14. Диагностика

| Симптом | Где смотреть | Обычная причина |
|---|---|---|
| 502 Bad Gateway | `journalctl -u mabl-lms -n 100` | сервис не запустился (ошибка в env) |
| API отвечает «Не найдена строка подключения» | `/etc/mabl-lms.env` | пустой `DATABASE_URL` |
| Запросы к БД висят | группа безопасности кластера | закрыт порт 6432 из подсети VM |
| «Файловое хранилище не настроено» | `/etc/mabl-lms.env` | нет ключей `S3_*` |
| SCORM: «Материалы недоступны» | `journalctl -u mabl-lms` | файлы не перенесены (шаг 7) |
| 413 при загрузке файла | nginx `client_max_body_size`, `MAX_UPLOAD_MB` | лимит меньше размера файла |
| Сессии слетели после переезда | `AUTH_SECRET` | секрет не совпал с прежним |

Полезные команды:

```bash
sudo systemctl restart mabl-lms          # перезапуск
journalctl -u mabl-lms -f                # живые логи
journalctl -u mabl-lms --since "1 hour ago" | grep -i error
sudo tail -f /var/log/nginx/mabl-lms.error.log
psql "$DATABASE_URL" -c "SELECT count(*) FROM content;"
```
