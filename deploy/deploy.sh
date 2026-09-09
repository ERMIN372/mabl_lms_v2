#!/usr/bin/env bash
# Обновление приложения на VM: забрать код с GitHub, собрать, перезапустить.
#
#   cd /srv/mabl-lms && ./deploy/deploy.sh [ветка]
#
# По умолчанию берётся ветка main.
set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="${APP_DIR:-/srv/mabl-lms}"
SERVICE="${SERVICE:-mabl-lms}"

cd "$APP_DIR"

echo "==> Забираю ветку $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Устанавливаю зависимости"
npm ci

echo "==> Собираю фронтенд и сервер"
npm run build

echo "==> Перезапускаю сервис $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Жду готовности"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null 2>&1; then
    echo "==> Готово: $(curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz")"
    exit 0
  fi
  sleep 1
done

echo "!! Сервис не ответил за 30 секунд. Логи:" >&2
sudo journalctl -u "$SERVICE" -n 50 --no-pager >&2
exit 1
