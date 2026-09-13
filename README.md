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
