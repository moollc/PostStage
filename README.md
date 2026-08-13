# PostStage

Local canvas to ideate a social post, preview how it lands on each platform, see what each part of the post is for, score marketability, plan interactions and monetization, and talk to coding agents already running in Herdr.

## Run

Needs Node 18+.

**HTTPS (preferred):** install [mkcert](https://github.com/FiloSottile/mkcert). On first start the launcher generates `build/certs/` and serves `https://localhost` (port starts at 7744).

**HTTP fallback:** if mkcert is missing or certs cannot be created, the launcher still starts and serves the same app and `/api` routes at `http://127.0.0.1:PORT` (no cert warnings).

macOS: double-click `start.command`  
Windows: double-click `start.bat`  
Linux: `./start.sh`

Or:

```
npm start
```

Flags: `--dev` (relaxed CSP), `--no-open` (do not open a browser), `--certs-only` (generate certs and exit; requires mkcert), `--port N`.

## Layout

- One canvas: idea cards + the stage card (the post)
- Platform switcher: X, Instagram, TikTok, YouTube, LinkedIn, Facebook
- Inspector: structure jobs, marketability checks, expected interactions, monetization, Herdr agent dock
- Drafts stay in the browser (localStorage). No account required.

## Agent dock

The agent dock talks to Herdr running locally on this machine only — the launcher's `/api/agents` route shells out to `herdr` on localhost, and the server itself listens on `127.0.0.1`, not a public address. It is not a hosted or public API, and there is no remote agent access. If Herdr is not running, the rest of the dashboard still works.

## Optional Rust scorer

`build/score/` is a WASM crate. The UI always uses `source/shared/score.js` unless a WASM export is present.
