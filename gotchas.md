# PABot — Gotchas

Hard rules learned from real mistakes. Read this before touching any code.

---

- **Claude wrapping JSON in markdown**: Claude sometimes returns `\`\`\`json\n{...}\n\`\`\`` instead of raw JSON. Always extract with regex: `rawText.match(/\{[\s\S]*\}/)` and parse the match, not the raw response text.

- **Claude refusing past-date tasks**: Prompt-based attempts to stop Claude from questioning past dates all fail eventually. Fix is architectural — use `output_config.format` with JSON schema to force Claude into pure extractor mode, then handle past/future logic server-side in `resolveIntent()`. Never rely on prompt instructions for this.

- **PM2 not found in terminal**: `pm2` is often not on the Windows PATH even after global install. Always use `npx pm2 <command>` as the reliable fallback. Alternatively: `./node_modules/.bin/pm2`.

- **`content-visibility: auto` breaks `position: sticky`**: Applying `content-visibility: auto` directly to elements that have `position: sticky` children breaks the stickiness — sticky is scoped to the containment context. Fix: wrap the content in a container div and apply `content-visibility: auto` to the container, not the sticky element itself.

- **`npm start` from wrong directory**: On Windows paths with spaces, `cd` requires the `/d` flag: `cd /d "E:\Chris\Documents\Claude local sessions\pabot"`. Running `npm start` from the wrong directory throws ENOENT.

- **Server not picking up code changes**: A stale PM2/node process can cache old code. If changes aren't reflecting after restart, force-kill the port first: `npx kill-port 3000`, then restart PM2.

- **Anthropic API returning 402 (credit balance)**: If API calls fail silently or return 402, check credit balance at console.anthropic.com. The error message in the server log will say "credit balance too low."

- **Infinite scroll + sticky headers**: When using IntersectionObserver sentinels for infinite scroll, the observer's `root` must be the scrollable container element (`#task-view`), not `document`. Using `document` causes the observer to fire immediately for all off-screen elements.
