# DearPDF

Private, in-browser PDF tools. Files never leave this device.

Live tools live under `/pdf-tools/*` (ported from DearColleague’s PDF suite, DearPDF-branded). Legacy `/tools/*` URLs redirect to the new paths.

## Develop

```bash
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"
fnm use 22
pnpm install
pnpm dev
```

## Build & deploy (Cloudflare Pages)

```bash
pnpm build
pnpm deploy
# or: npx wrangler pages deploy out --project-name=dearpdf
```

Static export (`output: 'export'`) — all PDF processing is client-side.

## Private analytics (`/admin`)

Password-protected usage dashboard. Cloudflare Pages Functions write privacy-safe events to D1 (`dearpdf-stats`).

Secrets (Pages → Settings → Environment variables / Secrets), Production:

- `ADMIN_PASSWORD` — the admin password you already chose
- `ADMIN_SESSION_SECRET` — random signing secret for the HttpOnly session cookie

Telemetry payload is only `{ tool, event_type, session_id }`. Never filenames or file contents.
