# FreeCell PWA

An ad-free FreeCell you can host on your own server and install on your phone
like a native app. No build step, no dependencies, no tracking — just static
files.

- **Microsoft-compatible numbered deals** (1 – 1,000,000). Deal #11982 is
  still impossible; deal #617 is still the classic.
- **Tap or drag** to move. Tap a card twice to send it to the best spot.
  Supermoves (moving a run using free cells / empty columns) are supported.
- **Unlimited undo / redo** and **auto-move** of safe cards to the foundations.
- **Hints and a solver.** The hint button runs a solver in a background thread
  and highlights the next move. A dot in the top bar shows whether the current
  position is still solvable (green), dead (red), or unknown (grey).
- **Stats & streaks** kept in the browser: games played, win rate, current and
  best streak, best time, fewest moves, and a recent-games list.
- **Works offline** once installed; your current game survives a reload.
- Keyboard on desktop: `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `H` hint, `N` new game.

## Run it

### Docker (easiest on a home server)

```bash
docker compose up -d --build
# → http://<server-ip>:8090
```

Change the host port in `compose.yaml` if 8090 is taken.

### Any static web server

Everything in this folder is static. Point nginx, Caddy, Apache, a Home
Assistant add-on, or `python3 -m http.server` at it. `nginx.conf` shows the
one thing that matters: serve `sw.js` with `Cache-Control: no-cache` so
updates reach installed copies.

### Local development

```bash
npm test          # engine + solver unit tests (Node 20+, no install needed)
npm run serve     # static server on http://localhost:8080
```

## Installing on your phone ("Add to Home screen")

Browsers only offer to install a PWA — and only run the service worker that
makes it work offline — over **HTTPS** (or `localhost`). Plain `http://192.168.x.x:8090`
will play fine in the browser but won't install. Pick one:

1. **Reverse proxy with a real certificate** — if you already run Caddy,
   Nginx Proxy Manager, or Traefik with Let's Encrypt for other services, add
   `freecell.yourdomain.tld` pointing at the container. This is the cleanest.
2. **Tailscale** — `tailscale serve --bg 8090` on the server gives you an
   HTTPS URL like `https://server.tailnet-name.ts.net` that works from your
   phone anywhere, with a valid certificate and no port forwarding.
3. **Caddy with its internal CA** — Caddy can mint a local certificate
   (`tls internal`); install Caddy's root CA on the phone once.

Then open the URL in Chrome on Android, tap the menu, and choose
**Install app** / **Add to Home screen**.

## Updating

Bump `CACHE_VERSION` in `sw.js` (and `APP_VERSION` in `src/app.js`) whenever
you change any file, then rebuild the container. Installed copies will show a
"new version is ready — Reload" toast the next time they're opened.

## How it works

```
index.html / style.css       app shell, phone-first layout
src/engine.js                rules: MS dealer, move validation, supermoves, safe auto-move
src/game.js                  session: undo/redo history, auto-move, serialisation
src/solver.js                best-first search solver (hints, solvability)
src/solver-worker.js         runs the solver in a Web Worker
src/storage.js               localStorage: current game, stats, settings
src/app.js                   UI: rendering, tap/drag input, dialogs, service-worker updates
sw.js / manifest.webmanifest PWA offline cache and install metadata
test/                        Node unit tests + a Playwright smoke test
```

Cards are numbered `0–51` the same way Microsoft's dealer numbers them
(`rank = n >> 2`, `suit = n & 3` with suits in the order ♣ ♦ ♥ ♠), and the
dealer uses the same linear-congruential generator, so deal numbers line up
with every other MS-compatible FreeCell.

## License

MIT
