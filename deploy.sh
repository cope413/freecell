#!/usr/bin/env bash
# Rebuild and redeploy the FreeCell stack.
# Usage: ./deploy.sh          (pull latest git, rebuild, restart)
#        ./deploy.sh --no-pull  (skip git pull, just rebuild what's here)
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
    echo "ERROR: .env with TUNNEL_TOKEN not found next to compose.yaml" >&2
    exit 1
fi

if [[ "${1:-}" != "--no-pull" ]] && [[ -d .git ]]; then
    echo "==> Pulling latest code"
    git pull --ff-only
fi

echo "==> Rebuilding and restarting containers"
docker compose up -d --build --remove-orphans

echo "==> Waiting for containers to report healthy"
deadline=$((SECONDS + 120))
while true; do
    app=$(docker inspect -f '{{.State.Health.Status}}' freecell 2>/dev/null || echo missing)
    tun=$(docker inspect -f '{{.State.Health.Status}}' freecell-tunnel 2>/dev/null || echo missing)
    if [[ "$app" == "healthy" && "$tun" == "healthy" ]]; then
        break
    fi
    if (( SECONDS >= deadline )); then
        echo "ERROR: timed out waiting for health (app: $app, tunnel: $tun)" >&2
        echo "--- recent logs ---" >&2
        docker compose logs --tail=20 >&2
        exit 1
    fi
    sleep 3
done

echo "==> Cleaning up old images"
docker image prune -f >/dev/null

echo "==> Checking https://freecell.landryfam.com"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://freecell.landryfam.com || echo 000)
if [[ "$code" == "200" ]]; then
    echo "Deployed OK — site is live (HTTP $code)"
else
    echo "WARNING: containers are healthy but the site returned HTTP $code" >&2
    echo "Give Cloudflare a few seconds and try again, or check: docker compose logs cloudflared" >&2
fi
