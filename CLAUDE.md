# PABot — Project Directives

Read `gotchas.md` in this directory before touching any code. All hard-learned rules from previous sessions live there.

## Stack
- **Backend**: Node.js + Express (`server.js`) — runs via PM2, port 3000
- **Frontend**: Vanilla JS (`app.js`), HTML (`index.html`), CSS (`styles.css`) — no framework, no build step
- **Data**: localStorage (keys: `pabot_messages`, `pabot_tasks`, `pabot_journals`)
- **AI**: Claude API via `@anthropic-ai/sdk`, JSON schema enforcement for structured output
- **Context**: `context.json` — Chris's schedule, habits, timezone (America/Toronto)

## Key files
| File | Purpose |
|------|---------|
| `server.js` | Express server, Claude API calls, intent routing |
| `app.js` | All frontend logic — rendering, event handlers, API calls |
| `styles.css` | iMessage dark palette via CSS variables |
| `index.html` | Three views: chat-view, task-view, journal-view |
| `context.json` | Personal context injected into Claude system prompt |
| `gotchas.md` | Hard rules from past mistakes — read before editing |

## CSS palette — never hardcode colors
All colors are CSS variables in `:root` in `styles.css`. Always use the variables:
```
--bg-primary: #000000
--bg-surface: #1c1c1e
--bg-elevated: #2c2c2e
--bubble-user: #0a84ff
--accent: #0a84ff
--text-primary: #ffffff
--text-secondary: #8e8e93
--border: #38383a
```

## Server vs frontend changes
- **Frontend only** (app.js, styles.css, index.html): just refresh the browser tab, no restart needed
- **Backend changes** (server.js): must restart PM2 — `npx pm2 restart pabot`
- **PM2 not on PATH**: use `npx pm2` instead of `pm2`

## Next items in build order
1. Push notification setup — Web Push API + service worker
2. Reminder scheduling — server fires notification at `reminder_iso` time
3. PWA config — manifest, service worker, installable on Android
4. Database migration — localStorage → Supabase
5. Deployment — frontend to Vercel, backend to Railway
