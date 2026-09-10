# DearPDF

Private, in-browser PDF tools for [dearpdf.in](https://dearpdf.in).

**Drop a file. Get it back fixed. Nothing uploaded.**

All PDF processing runs 100% client-side in the browser (pdf-lib, PDF.js, qpdf WASM, Tesseract.js). Files are never uploaded to a server for conversion.

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- pnpm
- Client libraries: `pdf-lib`, `pdfjs-dist`, `qpdf-run`, `tesseract.js`, `fflate`

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm build
pnpm start
```

## Privacy note

Every tool page shows a privacy chip: **Runs in your browser · Files stay on this device.** Processing uses Web APIs and WASM in the tab. OCR may fetch language data into the browser cache from Tesseract’s public model CDN; the PDF bytes themselves are not sent to DearPDF.

## Deploy

Any Node host that can run `next start` works for v1 (Vercel, Cloudflare Workers with OpenNext/adapter, a VPS, etc.). Cloudflare Wrangler is optional and not required for local development.

## Tool catalogue

Organise · Shrink & send · Edit & mark · Convert · Secure & fix — see the home page for the full list. Tools marked **Partial** document honest browser limits (OCR accuracy, simplified Word layout, raster unlock, structural repair).
