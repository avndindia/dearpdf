import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  applyBatesNumbering,
  formatBatesLabel,
  nUpGrid,
  nUpPdf,
  pdfToHandwritingNotebook,
} from "../src/lib/pdf-extra-tools.ts";
import { organisePdfPages } from "../src/lib/pdf-tools.ts";

async function makePdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([200 + i * 10, 300]);
    page.drawRectangle({ x: 10, y: 10, width: 40, height: 40, color: rgb(0.8, 0.2, 0.2) });
  }
  return doc.save();
}

test("n-up grid sizes", () => {
  assert.deepEqual(nUpGrid(2), { cols: 2, rows: 1 });
  assert.deepEqual(nUpGrid(4), { cols: 2, rows: 2 });
  assert.deepEqual(nUpGrid(6), { cols: 3, rows: 2 });
  assert.deepEqual(nUpGrid(9), { cols: 3, rows: 3 });
  assert.deepEqual(nUpGrid(16), { cols: 4, rows: 4 });
});

test("n-up builds fewer sheets than source pages", async () => {
  const source = await makePdf(8);
  const output = await nUpPdf(source, {
    pagesPerSheet: 4,
    paperSize: "a4",
    orientation: "portrait",
    margin: 24,
    gap: 8,
    cellBorder: true,
  });
  const doc = await PDFDocument.load(output);
  assert.equal(doc.getPageCount(), 2);
});

test("bates numbering continues across files", async () => {
  const a = await makePdf(2);
  const b = await makePdf(3);
  const { results, csv } = await applyBatesNumbering(
    [
      { name: "a.pdf", bytes: a },
      { name: "b.pdf", bytes: b },
    ],
    {
      prefix: "ABC",
      suffix: "",
      startNumber: 1,
      digits: 6,
      position: "bottom-right",
      margin: 20,
      fontSize: 12,
      color: "#111111",
      whitePlate: true,
    },
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].startLabel, "ABC000001");
  assert.equal(results[0].endLabel, "ABC000002");
  assert.equal(results[1].startLabel, "ABC000003");
  assert.equal(results[1].endLabel, "ABC000005");
  assert.match(csv, /a\.pdf/);
  assert.equal(formatBatesLabel("X", 42, 4, "-Z"), "X0042-Z");
});

test("organisePdfPages supports horizontal flip", async () => {
  const source = await makePdf(1);
  const flipped = await organisePdfPages(source, [
    { pageIndex: 0, rotation: 0, flipHorizontal: true },
  ]);
  const doc = await PDFDocument.load(flipped);
  assert.equal(doc.getPageCount(), 1);
});

test("handwriting notebook renders pages from text", async () => {
  const fontBytes = await readFile(new URL("../public/fonts/Caveat-Regular.ttf", import.meta.url));
  const output = await pdfToHandwritingNotebook(
    "Dear PDF handwriting test. This should wrap across a few lines on ruled paper.",
    {
      paper: "ruled",
      fontBytes,
      fontSize: 22,
      lineHeight: 28,
      inkColor: "#1e3a8a",
      margin: 72,
      messiness: 0.3,
      slant: 3,
    },
  );
  const doc = await PDFDocument.load(output);
  assert.ok(doc.getPageCount() >= 1);
});
