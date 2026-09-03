# Hosting at freecell.landryfam.com

The stack is two containers: `freecell` (nginx serving the PWA) and
`freecell-tunnel` (cloudflared, which publishes it at
https://freecell.landryfam.com without opening any ports on your router).
Both restart automatically and have health checks; cloudflared only starts
once the app container reports healthy.

## Cloudflare setup (already done — Sept 3, 2026)

Created via the API, following the one-tunnel-per-app pattern:

- Tunnel: `freecell` (id `397b6cda-63d8-4914-8753-518ac62f2f7f`),
  remotely managed (config lives in Cloudflare, not a local config file)
- Ingress: `freecell.landryfam.com` → `http://freecell:80`, with a
  `http_status:404` catch-all
- DNS: proxied CNAME `freecell.landryfam.com` →
  `397b6cda-...cfargotunnel.com`

To change the route later: Zero Trust → Networks → Tunnels → freecell.

## On the server

Put the `.env` file (contains `TUNNEL_TOKEN=...`) next to `compose.yaml`,
then:

```sh
docker compose up -d --build
```

Check status with `docker compose ps` — both services should show
`(healthy)`. Then visit https://freecell.landryfam.com.

## Updating the game

```sh
git pull
docker compose up -d --build
```

## Notes

- Port 8090 is still mapped for LAN access (http://server-ip:8090); remove
  the `ports:` block from `compose.yaml` if you only want access through
  Cloudflare.
- `.env` holds the tunnel token and is gitignored — don't commit it.
- Health checks: nginx serves `GET /healthz`; cloudflared is probed with
  `cloudflared tunnel ready` against its metrics endpoint. Docker restarts
  either container if it exits, and `restart: unless-stopped` brings the
  whole stack back after a reboot.
