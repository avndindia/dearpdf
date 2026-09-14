import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strFromU8 } from "fflate";
import { createEditableDocx } from "../src/lib/docx.ts";
import { downloadGeneratedFile } from "../src/lib/browser-download.ts";
import {
  summarizeExtractive,
  splitSentences,
  repairPdfText,
  isUsableSummarySentence,
  isLegalPreambleOrBoilerplate,
  shapeBulletText,
  preCleanDocumentText,
  shouldRejectAsBullet,
} from "../src/lib/on-device-summary.ts";
import { applyPdfEdits, pageIndexesNeedingRedaction, replacePdfPagesWithImages } from "../src/lib/pdf-editor.ts";
import {
  addPageNumbersPdf,
  createFilesZip,
  cropPdf,
  extractPdfPages,
  flattenAcroFormFieldsIfPresent,
  countPdfFormFields,
  inspectPdf,
  formatPageNumberLabel,
  formatPageSelection,
  imagesToPdf,
  imageToSinglePagePdf,
  keepSmallerPdf,
  mergePdfDocuments,
  mergePdfPageOrder,
  organisePdfPages,
  BLANK_PDF_PAGE_INDEX,
  A4_PAGE_SIZE,
  optimisePdfStructure,
  parsePageSelection,
  splitPdfIntoZip,
  splitPdfIntoEqualPartsZip,
  splitPdfEveryNPagesZip,
  splitPdfByMaximumBytes,
  rasterizedPagesToPdf,
  rasterizedPagesToSizedPdfParts,
  watermarkPdf,
  watermarkPreviewFontSizePx,
  watermarkPreviewInsetPercent,
  watermarkPreviewScale,
  watermarkPdfRotationDegrees,
  stampPdfWithImage,
  updatePdfMetadata,
} from "../src/lib/pdf-tools.ts";

async function makePdf(pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([595, 842]);
  }
  return document.save();
}

function decodedPdfText(bytes: Uint8Array) {
  const buf = Buffer.from(bytes);
  const latin = buf.toString("latin1");
  const parts = [latin];
  const re = /\/Length\s+(\d+)[\s\S]{0,240}?stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const slice = buf.subarray(match.index + match[0].length, match.index + match[0].length + Number(match[1]));
    try {
      parts.push(inflateSync(slice).toString("latin1"));
    } catch {
      parts.push(slice.toString("latin1"));
    }
  }
  return parts.join("\n").replace(/<([0-9A-Fa-f]+)>/g, (_unused, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

test("inspects and merges PDF documents in the supplied order", async () => {
  const first = await makePdf(2);
  const second = await makePdf(3);

  assert.deepEqual(await inspectPdf(first), { pageCount: 2 });

  const merged = await mergePdfDocuments([
    { name: "first.pdf", bytes: first },
    { name: "second.pdf", bytes: second },
  ]);

  const output = await PDFDocument.load(merged);
  assert.equal(output.getPageCount(), 5);
});

test("creates an editable Word document with Unicode text and page breaks", () => {
  const bytes = createEditableDocx([
    {
      pageNumber: 1,
      lines: ["Office order & posting", "केंद्रीय शासन"],
      widthPoints: 595,
      heightPoints: 842,
      blocks: [
        {
          kind: "paragraph",
          alignment: "center",
          runs: [
            { text: "Office order & posting", bold: true, underline: true, fontSize: 16 },
            { text: " केंद्रीय शासन", italic: true, fontSize: 12 },
          ],
        },
        {
          kind: "table",
          borders: true,
          columnWidths: [180, 240],
          rows: [
            [{ runs: [{ text: "Name", bold: true }] }, { runs: [{ text: "Posting", bold: true }] }],
            [{ runs: [{ text: "A. Colleague" }] }, { runs: [{ text: "Establishment" }, { text: "Branch", breakBefore: true }] }],
          ],
        },
      ],
    },
    { pageNumber: 3, lines: ["Second selected page"] },
  ], {
    title: "Office Order",
    includePageLabels: true,
  });
  const archive = unzipSync(bytes);
  assert.ok(archive["[Content_Types].xml"]);
  assert.ok(archive["word/document.xml"]);
  const documentXml = strFromU8(archive["word/document.xml"]);
  assert.match(documentXml, /Office order &amp; posting/);
  assert.match(documentXml, /केंद्रीय शासन/);
  assert.match(documentXml, /Page 3/);
  assert.match(documentXml, /w:type w:val="nextPage"/);
  assert.match(documentXml, /<w:b\/>/);
  assert.match(documentXml, /<w:u w:val="single"\/>/);
  assert.match(documentXml, /<w:jc w:val="center"\/>/);
  assert.match(documentXml, /<w:tbl>/);
  assert.match(documentXml, /<w:br\/><w:t>Branch<\/w:t>/);
  assert.throws(() => createEditableDocx([]), /no pages/i);
});

test("requires at least two PDF documents", async () => {
  const only = await makePdf(1);
  await assert.rejects(
    mergePdfDocuments([{ name: "only.pdf", bytes: only }]),
    /at least two/i,
  );
});

test("merges individual pages from multiple PDFs in visual order", async () => {
  const first = await makePdf(2);
  const secondDocument = await PDFDocument.create();
  secondDocument.addPage([300, 400]);
  const second = await secondDocument.save();
  const merged = await mergePdfPageOrder(
    [
      { id: "first", name: "first.pdf", bytes: first },
      { id: "second", name: "second.pdf", bytes: second },
    ],
    [
      { sourceId: "second", pageIndex: 0 },
      { sourceId: "first", pageIndex: 1 },
    ],
  );
  const output = await PDFDocument.load(merged);
  assert.equal(output.getPageCount(), 2);
  assert.deepEqual(output.getPage(0).getSize(), { width: 300, height: 400 });
  assert.deepEqual(output.getPage(1).getSize(), { width: 595, height: 842 });
});

test("parses page selections, preserves order, and removes duplicates", () => {
  assert.deepEqual(parsePageSelection("3, 1-2, 2, 5", 5), [2, 0, 1, 4]);
  assert.throws(() => parsePageSelection("0, 2", 5), /between 1 and 5/i);
  assert.throws(() => parsePageSelection("4-2", 5), /lower page/i);
  assert.throws(() => parsePageSelection("1, hello", 5), /not a valid/i);
});

test("formats page indices as compact ranges", () => {
  assert.equal(formatPageSelection([]), "");
  assert.equal(formatPageSelection([0, 1, 2, 5, 8, 9, 10]), "1-3, 6, 9-11");
  assert.equal(formatPageSelection([4, 0, 2, 1]), "1-3, 5");
});

test("extracts selected pages in the requested order", async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 200]);
  source.addPage([200, 300]);
  source.addPage([300, 400]);

  const extracted = await extractPdfPages(await source.save(), [2, 0]);
  const output = await PDFDocument.load(extracted);
  assert.equal(output.getPageCount(), 2);
  assert.deepEqual(output.getPage(0).getSize(), { width: 300, height: 400 });
  assert.deepEqual(output.getPage(1).getSize(), { width: 100, height: 200 });
});

test("splits every page into a numbered ZIP of one-page PDFs", async () => {
  const source = await makePdf(3);
  const archive = unzipSync(await splitPdfIntoZip(source, "office-order"));
  assert.deepEqual(Object.keys(archive), [
    "office-order-page-01.pdf",
    "office-order-page-02.pdf",
    "office-order-page-03.pdf",
  ]);

  for (const bytes of Object.values(archive)) {
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
});

test("splits a PDF into the requested number of nearly equal parts", async () => {
  const source = await makePdf(10);
  const archive = unzipSync(await splitPdfIntoEqualPartsZip(source, 3, "office-order"));
  assert.deepEqual(Object.keys(archive), [
    "office-order-part-01.pdf",
    "office-order-part-02.pdf",
    "office-order-part-03.pdf",
  ]);
  const pageCounts = await Promise.all(
    Object.values(archive).map(async (bytes) => (await PDFDocument.load(bytes)).getPageCount()),
  );
  assert.deepEqual(pageCounts, [4, 3, 3]);
  await assert.rejects(() => splitPdfIntoEqualPartsZip(source, 1), /at least 2 parts/i);
  await assert.rejects(() => splitPdfIntoEqualPartsZip(source, 11), /no more than 10 parts/i);
});

test("splits a PDF after every N pages into a numbered ZIP", async () => {
  const source = await makePdf(10);
  const archive = unzipSync(await splitPdfEveryNPagesZip(source, 3, "office-order"));
  assert.deepEqual(Object.keys(archive), [
    "office-order-pages-01-03.pdf",
    "office-order-pages-04-06.pdf",
    "office-order-pages-07-09.pdf",
    "office-order-pages-10.pdf",
  ]);
  const pageCounts = await Promise.all(
    Object.values(archive).map(async (bytes) => (await PDFDocument.load(bytes)).getPageCount()),
  );
  assert.deepEqual(pageCounts, [3, 3, 3, 1]);
  await assert.rejects(() => splitPdfEveryNPagesZip(source, 0), /at least 1 page/i);
  await assert.rejects(() => splitPdfEveryNPagesZip(source, 10), /fewer than 10 pages/i);
});

test("split page offers split after every N pages", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/split/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Split after every N pages/);
  assert.match(page, /Pages per file/);
  assert.match(page, /splitPdfEveryNPagesZip/);
  assert.match(page, /PdfLazyPreviewControls/);
  assert.match(page, /loadPreviews/);
  assert.match(page, /toggleExtractPage/);
  assert.match(page, /suggestedExtractName/);
  assert.match(page, /The original PDF is still here/);
  assert.doesNotMatch(page, /Creating preview \$\{page\} of \$\{total\}/);
});

test("organises pages in the requested order with rotation and removal", async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 200]);
  source.addPage([200, 300]);
  source.addPage([300, 400]);

  const organised = await organisePdfPages(await source.save(), [
    { pageIndex: 2, rotation: 90 },
    { pageIndex: 0, rotation: 180 },
  ]);
  const output = await PDFDocument.load(organised);

  assert.equal(output.getPageCount(), 2);
  assert.deepEqual(output.getPage(0).getSize(), { width: 300, height: 400 });
  assert.equal(output.getPage(0).getRotation().angle, 90);
  assert.deepEqual(output.getPage(1).getSize(), { width: 100, height: 200 });
  assert.equal(output.getPage(1).getRotation().angle, 180);
  await assert.rejects(organisePdfPages(await source.save(), []), /at least one page/i);
});

test("organises pages can duplicate a page and insert a blank A4", async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 200]);
  source.addPage([200, 300]);

  const organised = await organisePdfPages(await source.save(), [
    { pageIndex: 0, rotation: 0 },
    { pageIndex: BLANK_PDF_PAGE_INDEX, rotation: 0 },
    { pageIndex: 0, rotation: 0 },
    { pageIndex: 1, rotation: 0 },
  ]);
  const output = await PDFDocument.load(organised);
  assert.equal(output.getPageCount(), 4);
  assert.deepEqual(output.getPage(0).getSize(), { width: 100, height: 200 });
  assert.equal(Math.round(output.getPage(1).getWidth()), Math.round(A4_PAGE_SIZE.width));
  assert.equal(Math.round(output.getPage(1).getHeight()), Math.round(A4_PAGE_SIZE.height));
  assert.deepEqual(output.getPage(2).getSize(), { width: 100, height: 200 });
  assert.deepEqual(output.getPage(3).getSize(), { width: 200, height: 300 });
});

test("creates one PDF page per image using standard and fitted layouts", async () => {
  const redPixel = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWsAAAAASUVORK5CYII=",
    "base64",
  ));
  const images = [
    { bytes: redPixel, mimeType: "image/png" as const, width: 100, height: 200, rotation: 0 },
    { bytes: redPixel, mimeType: "image/png" as const, width: 300, height: 100, rotation: 90 },
  ];

  const a4 = await PDFDocument.load(await imagesToPdf(images, {
    pageSize: "a4",
    orientation: "auto",
    margin: 42.52,
  }));
  assert.equal(a4.getPageCount(), 2);
  assert.ok(a4.getPage(0).getHeight() > a4.getPage(0).getWidth());
  assert.ok(a4.getPage(1).getHeight() > a4.getPage(1).getWidth());

  const fitted = await PDFDocument.load(await imagesToPdf([images[0]], {
    pageSize: "fit",
    orientation: "auto",
    margin: 0,
  }));
  assert.deepEqual(fitted.getPage(0).getSize(), { width: 75, height: 150 });
  await assert.rejects(imagesToPdf([], { pageSize: "a4", orientation: "auto", margin: 0 }), /at least one image/i);
});

test("merges a PDF with an image converted to a page", async () => {
  const redPixel = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWsAAAAASUVORK5CYII=",
    "base64",
  ));
  const photo = await imageToSinglePagePdf(redPixel, "image/png");
  assert.equal((await PDFDocument.load(photo)).getPageCount(), 1);
  const merged = await mergePdfPageOrder(
    [
      { id: "note", name: "note.pdf", bytes: await makePdf(1) },
      { id: "scan", name: "scan.png", bytes: photo },
    ],
    [
      { sourceId: "note", pageIndex: 0 },
      { sourceId: "scan", pageIndex: 0 },
    ],
  );
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 2);
});

test("adds text watermarks only to the selected PDF pages", async () => {
  const source = await makePdf(3);
  const outputBytes = await watermarkPdf(
    source,
    { kind: "text", text: "CONFIDENTIAL", color: "#b00000", size: 42 },
    { pageIndices: [1], position: "center", opacity: 0.25, rotation: -30 },
  );
  const output = await PDFDocument.load(outputBytes);
  assert.equal(output.getPageCount(), 3);
  assert.ok(outputBytes.length > source.length);
  await assert.rejects(
    watermarkPdf(source, { kind: "text", text: "", color: "#000000", size: 40 }, { pageIndices: [0], position: "center", opacity: 0.2, rotation: 0 }),
    /watermark text/i,
  );
  await assert.rejects(
    watermarkPdf(source, { kind: "text", text: "DRAFT", color: "#000000", size: 40 }, { pageIndices: [], position: "center", opacity: 0.2, rotation: 0 }),
    /at least one page/i,
  );
});

test("scales watermark preview text to the on-screen page width", () => {
  assert.equal(watermarkPreviewFontSizePx(48, 595.28, 595.28), 48);
  assert.equal(watermarkPreviewFontSizePx(96, 297.64, 595.28), 48);
  assert.equal(watermarkPreviewInsetPercent(595.28), 28 / 595.28 * 100);
  assert.equal(watermarkPreviewScale(0, 595.28), 1);
});

test("maps CSS watermark rotation to the opposite PDF angle", () => {
  assert.equal(watermarkPdfRotationDegrees(-30), 30);
  assert.equal(watermarkPdfRotationDegrees(45), -45);
  assert.equal(watermarkPdfRotationDegrees(0), 0);
});

test("optimises PDF structure without changing the page count", async () => {
  const source = await makePdf(4);
  const optimised = await optimisePdfStructure(source);
  assert.equal((await PDFDocument.load(optimised)).getPageCount(), 4);
});

test("keeps the original whenever a compressed PDF is not smaller", () => {
  const original = new Uint8Array([1, 2, 3, 4]);
  const smaller = keepSmallerPdf(original, new Uint8Array([8, 9]));
  assert.equal(smaller.usedOriginal, false);
  assert.deepEqual(smaller.bytes, new Uint8Array([8, 9]));

  const equal = keepSmallerPdf(original, new Uint8Array([5, 6, 7, 8]));
  assert.equal(equal.usedOriginal, true);
  assert.deepEqual(equal.bytes, original);

  const larger = keepSmallerPdf(original, new Uint8Array([5, 6, 7, 8, 9]));
  assert.equal(larger.usedOriginal, true);
  assert.deepEqual(larger.bytes, original);
  assert.ok(larger.bytes.length <= original.length);
});

test("rebuilds rasterized JPEG pages at their original PDF dimensions", async () => {
  const jpeg = Uint8Array.from(Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
    "base64",
  ));
  const output = await PDFDocument.load(await rasterizedPagesToPdf([
    { bytes: jpeg, width: 595.28, height: 841.89 },
    { bytes: jpeg, width: 792, height: 612 },
  ]));
  assert.equal(output.getPageCount(), 2);
  assert.deepEqual(output.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  assert.deepEqual(output.getPage(1).getSize(), { width: 792, height: 612 });
  await assert.rejects(rasterizedPagesToPdf([]), /no pages/i);
});

test("packs rasterized pages into PDFs below a byte limit", async () => {
  const jpeg = Uint8Array.from(Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
    "base64",
  ));
  const page = { bytes: jpeg, width: 595.28, height: 841.89 };
  const onePage = await rasterizedPagesToPdf([page]);
  const twoPages = await rasterizedPagesToPdf([page, page]);
  const maximumBytes = Math.floor((onePage.length + twoPages.length) / 2);
  const parts = await rasterizedPagesToSizedPdfParts([page, page, page], maximumBytes);

  assert.ok(parts.length >= 2);
  assert.ok(parts.every((part) => part.bytes.length <= maximumBytes));
  assert.equal(parts.reduce((sum, part) => sum + part.pageCount, 0), 3);
  for (const part of parts) {
    assert.equal((await PDFDocument.load(part.bytes)).getPageCount(), part.pageCount);
  }
});

test("splits a PDF into original-page parts under a byte limit", async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) {
    const page = document.addPage([595, 842]);
    page.drawText(`Page ${index + 1} ${"x".repeat(1800)}`, { x: 40, y: 780, size: 10 });
  }
  const bytes = await document.save();
  const onePage = await extractPdfPages(bytes, [0]);
  const maximumBytes = Math.max(1024, onePage.length + 80);
  const parts = await splitPdfByMaximumBytes(bytes, maximumBytes);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((part) => part.bytes.length <= maximumBytes));
  assert.equal(parts[0].pageStart, 1);
  assert.equal(parts[parts.length - 1].pageEnd, 4);
  assert.equal(parts.reduce((sum, part) => sum + (part.pageEnd - part.pageStart + 1), 0), 4);
});

test("creates a ZIP archive for multiple exported page images", () => {
  const archive = unzipSync(createFilesZip([
    { name: "page-01.png", bytes: new Uint8Array([1, 2, 3]) },
    { name: "page-02.png", bytes: new Uint8Array([4, 5, 6]) },
  ]));
  assert.deepEqual(Object.keys(archive), ["page-01.png", "page-02.png"]);
  assert.deepEqual(Array.from(archive["page-02.png"]), [4, 5, 6]);
  assert.throws(() => createFilesZip([]), /no files/i);
});

test("adds page numbers to selected pages without changing the page count", async () => {
  const source = await makePdf(3);
  const numbered = await addPageNumbersPdf(source, {
    pageIndices: [0, 2],
    position: "bottom-center",
    format: "page-number",
    startAt: 5,
    fontSize: 11,
    margin: 28,
    color: "#222222",
  });
  assert.equal((await PDFDocument.load(numbered)).getPageCount(), 3);
  assert.ok(numbered.length > source.length);
  const customised = await addPageNumbersPdf(source, {
    pageIndices: [0, 1, 2],
    position: "top-right",
    format: "page-number-of-total",
    startAt: 1,
    fontSize: 12,
    margin: 24,
    color: "#000000",
    prefix: "Annexure · ",
    suffix: " · Office copy",
  });
  assert.equal((await PDFDocument.load(customised)).getPageCount(), 3);
  const roman = await addPageNumbersPdf(source, {
    pageIndices: [0, 1, 2],
    position: "bottom-center",
    format: "roman",
    startAt: 1,
    fontSize: 11,
    margin: 28,
    color: "#111111",
    bold: true,
  });
  assert.equal((await PDFDocument.load(roman)).getPageCount(), 3);
  assert.equal(formatPageNumberLabel("roman", 4, 10), "iv");
  assert.equal(formatPageNumberLabel("letter", 2, 10), "B");
  assert.equal(formatPageNumberLabel("fraction", 3, 10), "3/10");
  await assert.rejects(
    addPageNumbersPdf(source, { pageIndices: [], position: "bottom-center", format: "number", startAt: 1, fontSize: 11, margin: 28, color: "#000000" }),
    /at least one page/i,
  );
});

test("crops only selected PDF pages", async () => {
  const source = await makePdf(2);
  const cropped = await PDFDocument.load(await cropPdf(source, {
    pageIndices: [1],
    top: 20,
    right: 30,
    bottom: 40,
    left: 50,
  }));
  assert.deepEqual(cropped.getPage(0).getCropBox(), { x: 0, y: 0, width: 595, height: 842 });
  assert.deepEqual(cropped.getPage(1).getCropBox(), { x: 50, y: 40, width: 515, height: 782 });
  await assert.rejects(
    cropPdf(source, { pageIndices: [0], top: 500, right: 300, bottom: 500, left: 300 }),
    /too little/i,
  );
});

test("updates embedded PDF metadata", async () => {
  const output = await PDFDocument.load(await updatePdfMetadata(await makePdf(1), {
    title: "Office Order",
    author: "Establishment Section",
    subject: "Posting",
    keywords: ["office", "posting"],
  }));
  assert.equal(output.getTitle(), "Office Order");
  assert.equal(output.getAuthor(), "Establishment Section");
  assert.equal(output.getSubject(), "Posting");
  assert.equal(output.getKeywords(), "office posting");
});

test("flattens interactive PDF form fields", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 300]);
  const field = document.getForm().createTextField("employee.name");
  field.setText("A. Colleague");
  field.addToPage(page, { x: 20, y: 220, width: 180, height: 24 });
  const withFields = await document.save();
  assert.equal(await countPdfFormFields(withFields), 1);
  const prepared = await PDFDocument.load(await flattenAcroFormFieldsIfPresent(withFields));
  assert.equal(prepared.getForm().getFields().length, 0);
  const plain = await flattenAcroFormFieldsIfPresent(await makePdf(1));
  assert.equal((await PDFDocument.load(plain)).getPageCount(), 1);
  assert.equal(await countPdfFormFields(plain), 0);

  const { readFile } = await import("node:fs/promises");
  const pageSource = await readFile(new URL("../src/components/simple-pdf-tool-page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /simpleDownloadName/);
  assert.match(pageSource, /flattenPdf/);
  assert.match(pageSource, /Flatten \$\{selected\.pageCount\}/);
  assert.match(pageSource, /image-based pages/);
  assert.match(pageSource, /The original PDF is still here/);
  assert.match(pageSource, /repairedPages === selected.pageCount/);
  assert.match(pageSource, /Repair \$\{selected.pageCount\}/);
  assert.doesNotMatch(pageSource, /fieldCount > 0/);
});
test("places a signature image on selected PDF pages", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.addPage([300, 400]);
  const pixel = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWsAAAAASUVORK5CYII=",
    "base64",
  ));
  const signed = await stampPdfWithImage(await source.save(), pixel, "image/png", {
    pageIndices: [1],
    position: "bottom-right",
    widthPercent: 24,
  });
  assert.equal((await PDFDocument.load(signed)).getPageCount(), 2);
  assert.ok(signed.length > (await source.save()).length);

  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/sign/page.tsx", import.meta.url), "utf8");
  assert.match(page, /signDownloadName/);
  assert.match(page, /SIGNATURE_STORAGE_KEY/);
  assert.match(page, /Sign \$\{selection\.pages\.length\}/);
  assert.match(page, /The original PDF and this signature stay here/);
});

test("Protect PDF confirms the password and names the download", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/lock/page.tsx", import.meta.url), "utf8");
  assert.match(page, /lockDownloadName/);
  assert.match(page, /Confirm password/);
  assert.match(page, /Show password/);
  assert.match(page, /The original unprotected PDF is still here/);
  assert.match(page, /password === confirmation/);
});

test("Unlock PDF names the download and keeps the original on a wrong password", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/unlock/page.tsx", import.meta.url), "utf8");
  assert.match(page, /unlockDownloadName/);
  assert.match(page, /Show password/);
  assert.match(page, /The original protected PDF is still here/);
  assert.match(page, /PasswordException/);
  assert.doesNotMatch(page, /setSelected\(null\);[\s\S]*PasswordException/);
});

test("PDF to Images names files, keeps the original, and can export the current page", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/pdf-to-images/page.tsx", import.meta.url), "utf8");
  assert.match(page, /imagesDownloadBase/);
  assert.match(page, /baseName}-p\$\{pageNumber\}/);
  assert.match(page, /Download this page/);
  assert.match(page, /The original PDF is still here/);
});

test("Images to PDF names the file, sorts naturally, and keeps the photos", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/images-to-pdf/page.tsx", import.meta.url), "utf8");
  assert.match(page, /imagesPdfDownloadName/);
  assert.match(page, /useState<ImageSortMode>\("name-asc"\)/);
  assert.match(page, /numeric: true/);
  assert.match(page, /The images are still here/);
  assert.match(page, /one image per page/);
});

test("Grayscale PDF names the file, keeps the colour original, and previews one grey page", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/grayscale/page.tsx", import.meta.url), "utf8");
  assert.match(page, /grayscaleDownloadName/);
  assert.match(page, /renderGrayPreview/);
  assert.match(page, /Grey preview/);
  assert.match(page, /The original colour PDF is still here/);
});

test("applies visual edits without changing the PDF page count", async () => {
  const source = await makePdf(2);
  const edited = await applyPdfEdits(source, [
    {
      id: "text-1",
      pageIndex: 0,
      kind: "text",
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.08,
      text: "Office copy",
      fontSize: 16,
      bold: true,
    },
    {
      id: "mark-1",
      pageIndex: 1,
      kind: "rectangle",
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      thickness: 2,
    },
  ]);
  assert.equal((await PDFDocument.load(edited)).getPageCount(), 2);
  assert.ok(edited.length > source.length);
});

test("redacted pages drop original text when flattened to images", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([595, 842]);
  const second = document.addPage([595, 842]);
  first.drawText("CONFIDENTIAL-SECRET", { x: 72, y: 720, size: 18, font });
  second.drawText("KEEP-VISIBLE-TEXT", { x: 72, y: 720, size: 18, font });
  const source = await document.save();
  const sourceText = decodedPdfText(source);
  assert.match(sourceText, /CONFIDENTIAL-SECRET/);
  assert.match(sourceText, /KEEP-VISIBLE-TEXT/);

  const jpeg = Uint8Array.from(Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
    "base64",
  ));
  const burned = await replacePdfPagesWithImages(source, [{
    pageIndex: 0,
    bytes: jpeg,
    width: 595,
    height: 842,
    mimeType: "image/jpeg",
  }]);
  const burnedText = decodedPdfText(burned);
  assert.equal((await PDFDocument.load(burned)).getPageCount(), 2);
  assert.doesNotMatch(burnedText, /CONFIDENTIAL-SECRET/);
  assert.match(burnedText, /KEEP-VISIBLE-TEXT/);

  const edited = await applyPdfEdits(source, [{
    id: "redact-1",
    pageIndex: 0,
    kind: "redact",
    x: 0.1,
    y: 0.1,
    width: 0.4,
    height: 0.08,
    thickness: 1,
  }]);
  assert.deepEqual(pageIndexesNeedingRedaction([{
    id: "redact-1",
    pageIndex: 0,
    kind: "redact",
    x: 0.1,
    y: 0.1,
    width: 0.4,
    height: 0.08,
    thickness: 1,
  }]), [0]);
  assert.equal((await PDFDocument.load(edited)).getPageCount(), 2);
});

test("downloads generated PDFs as named binary attachments", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let appended = false;
  let clicked = false;
  let removed = false;
  let revokeDelay = 0;
  let createdBlobType = "";
  let generatedFileName = "";
  const anchor = {
    href: "",
    download: "",
    rel: "",
    style: { display: "" },
    click() { clicked = true; },
    remove() { removed = true; },
  };

  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => anchor,
        body: { appendChild: () => { appended = true; } },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dispatchEvent: (event: CustomEvent<{ fileName: string }>) => {
          generatedFileName = event.detail.fileName;
          return true;
        },
        setTimeout: (_callback: () => void, delay: number) => {
          revokeDelay = delay;
          return 1;
        },
      },
    });
    URL.createObjectURL = (blob: Blob) => {
      createdBlobType = blob.type;
      return "blob:test-download";
    };
    URL.revokeObjectURL = () => {};

    downloadGeneratedFile(new Uint8Array([37, 80, 68, 70]) as BlobPart, "merged.pdf");

    assert.equal(createdBlobType, "application/octet-stream");
    assert.equal(anchor.href, "blob:test-download");
    assert.equal(anchor.download, "merged.pdf");
    assert.equal(anchor.rel, "noopener");
    assert.equal(anchor.style.display, "none");
    assert.equal(appended, true);
    assert.equal(clicked, true);
    assert.equal(removed, true);
    assert.equal(revokeDelay, 60_000);
    assert.equal(generatedFileName, "merged.pdf");
    assert.equal((globalThis.window as Window).__dearPdfGeneratedFile?.fileName, "merged.pdf");
    assert.equal((globalThis.window as Window).__dearPdfGeneratedFile?.nextStep, "download");

    appended = false;
    clicked = false;
    removed = false;
    (globalThis.window as Window).__dearPdfNextStep = "/pdf-tools/compress";
    downloadGeneratedFile(new Uint8Array([37, 80, 68, 70]) as BlobPart, "merged-next.pdf");
    assert.equal(appended, false);
    assert.equal(clicked, false);
    assert.equal(removed, false);
    assert.equal((globalThis.window as Window).__dearPdfGeneratedFile?.nextStep, "/pdf-tools/compress");
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    if (originalDocument === undefined) delete (globalThis as { document?: Document }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("PDF tools stay offline by default and keep per-tool bookmarks", async () => {
  const { readFile } = await import("node:fs/promises");
  const directory = await readFile(new URL("../components/pdf-tool-directory.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/pdf-tools/page.tsx", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../components/pdf-privacy-strip.tsx", import.meta.url), "utf8");
  const install = await readFile(new URL("../components/pdf-tools-install.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/pdf-tools/layout.tsx", import.meta.url), "utf8");
  const rootLayout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const errorCard = await readFile(new URL("../components/error-recovery-card.tsx", import.meta.url), "utf8");
  const offlineLib = await readFile(new URL("../src/lib/pdf-tools-offline.ts", import.meta.url), "utf8");
  const offlineRoot = await readFile(new URL("../components/pdf-tools-offline-root.tsx", import.meta.url), "utf8");
  const sw = await readFile(new URL("../public/pdf-tools-sw.js", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../public/pdf-tools.webmanifest", import.meta.url), "utf8");
  assert.match(page, /pdf-tools-heading/);
  assert.match(page, /PdfToolsInstall/);
  assert.doesNotMatch(page, /PdfToolsAccess|Bookmark Now|Ctrl\+D|webloc|navigator\.share/);
  assert.match(install, /beforeinstallprompt/);
  assert.match(install, /Install app/);
  assert.match(install, /if \(!promptEvent\) return null/);
  assert.doesNotMatch(install, /navigator\.share|webloc|Ctrl\+D|Bookmark Now/);
  assert.match(directory, /Bookmarked/);
  assert.match(directory, /pdf-tool-bookmark/);
  assert.doesNotMatch(directory, /is-popular/);
  assert.match(privacy, /Works without internet/);
  assert.doesNotMatch(page, /Bookmark Now|Ctrl\+D|webloc|navigator\.share/);
  assert.match(layout, /pdf-tools\.webmanifest/);
  assert.doesNotMatch(layout, /PdfToolsOfflineRoot/);
  assert.match(rootLayout, /PdfToolsOfflineRoot/);
  assert.doesNotMatch(layout, /PdfToolsToolChrome/);
  assert.match(offlineRoot, /syncPdfToolsOfflinePreference/);
  assert.match(offlineRoot, /window\.location\.assign/);
  assert.match(offlineRoot, /navigator\.onLine/);
  assert.match(offlineLib, /await enablePdfToolsOffline\(\)/);
  assert.match(offlineLib, /controllerchange/);
  assert.match(sw, /dearpdf-pdf-tools-v3/);
  assert.match(sw, /putAndCrawl/);
  assert.match(sw, /isRscRequest/);
  assert.match(sw, /Response\.redirect/);
  assert.match(sw, /request\.mode === "navigate"/);
  assert.match(sw, /cache\.match\("\/pdf-tools"\)/);
  assert.match(errorCard, /Open PDF tools/);
  assert.match(errorCard, /No internet/);
  assert.match(errorCard, /background: "#111"/);
  assert.match(offlineLib, /updateViaCache: "none"/);
  assert.match(manifest, /"start_url": "\/pdf-tools"/);
  const { togglePdfToolBookmark, isPdfToolBookmarked, listPdfToolBookmarks } = await import("../src/lib/pdf-tool-bookmarks.ts");
  const store = new Map<string, string>();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
      dispatchEvent() {},
    },
  });
  try {
    assert.equal(isPdfToolBookmarked("/pdf-tools/compress"), false);
    assert.equal(togglePdfToolBookmark("/pdf-tools/compress"), true);
    assert.deepEqual(listPdfToolBookmarks(), ["/pdf-tools/compress"]);
    assert.equal(togglePdfToolBookmark("/pdf-tools/compress"), false);
    assert.deepEqual(listPdfToolBookmarks(), []);
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("PDF to Word reconstructs aligned tables, merged cells, and lists", async () => {
  const { detectListMarker, extractFormattedPage, reconstructGridTable } = await import("../src/lib/pdf-to-word-layout.ts");
  const { createEditableDocx } = await import("../src/lib/docx.ts");
  const { unzipSync, strFromU8 } = await import("fflate");

  assert.equal(detectListMarker("(i) Leave travel concession")?.type, "roman");
  assert.equal(detectListMarker("(a) Family includes")?.type, "alpha");
  assert.equal(detectListMarker("1. Pay is drawn")?.type, "decimal");
  assert.equal(detectListMarker("• Keep the original")?.type, "bullet");
  assert.equal(detectListMarker("(c) Child")?.type, "alpha");

  function pdfItem(text: string, x: number, y: number, width = text.length * 6) {
    return { str: text, transform: [11, 0, 0, 11, x, y], width, fontName: "Times" };
  }

  const tablePage = extractFormattedPage([
    pdfItem("Office Memorandum", 180, 780, 160),
    pdfItem("Name", 50, 700, 40),
    pdfItem("Post", 240, 700, 40),
    pdfItem("Pay", 420, 700, 30),
    pdfItem("Ramesh", 50, 680, 50),
    pdfItem("Assistant", 240, 680, 60),
    pdfItem("44900", 420, 680, 40),
    pdfItem("(i) The employee may apply.", 50, 620, 220),
    pdfItem("(ii) The leave account shall be updated.", 50, 600, 260),
  ], {}, 595, [], []);
  const tables = tablePage.blocks.filter((block) => block.kind === "table");
  assert.equal(tables.length, 1);
  assert.equal(tables[0].kind === "table" ? tables[0].rows.length : 0, 2);
  assert.equal(tables[0].kind === "table" ? tables[0].rows[0].length : 0, 3);
  const lists = tablePage.blocks.filter((block) => block.kind === "paragraph" && block.list?.type === "roman");
  assert.equal(lists.length, 2);
  assert.match(lists[0].kind === "paragraph" ? lists[0].runs.map((run) => run.text).join("") : "", /The employee may apply/);

  const grid = reconstructGridTable(
    [
      { text: "Title", x: 55, y: 690, width: 200, fontSize: 11, fontName: "", fontFamily: "", underline: false },
      { text: "A", x: 55, y: 650, width: 20, fontSize: 11, fontName: "", fontFamily: "", underline: false },
      { text: "B", x: 220, y: 650, width: 20, fontSize: 11, fontName: "", fontFamily: "", underline: false },
    ],
    [
      { x1: 40, x2: 400, y: 720 },
      { x1: 40, x2: 400, y: 670 },
      { x1: 40, x2: 400, y: 620 },
    ],
    [
      { x: 40, y1: 620, y2: 720 },
      { x: 400, y1: 620, y2: 720 },
      { x: 200, y1: 620, y2: 670 },
    ],
  );
  assert.ok(grid);
  assert.equal(grid?.table.rows[0][0].gridSpan, 2);
  assert.equal(grid?.table.rows[1].length, 2);

  const bytes = createEditableDocx([{
    pageNumber: 1,
    blocks: [
      { kind: "paragraph", runs: [{ text: "The employee may apply." }], list: { type: "roman" } },
      { kind: "table", borders: true, rows: [[{ runs: [{ text: "Title" }], gridSpan: 2 }], [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }]] },
    ],
  }]);
  const documentXml = strFromU8(unzipSync(bytes)["word/document.xml"]);
  const numberingXml = strFromU8(unzipSync(bytes)["word/numbering.xml"]);
  assert.match(documentXml, /w:numPr/);
  assert.match(documentXml, /w:gridSpan w:val="2"/);
  assert.match(numberingXml, /lowerRoman/);
});

test("PDF to Word names the file, keeps the original, and reports pages converted", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/pdf-to-word/page.tsx", import.meta.url), "utf8");
  assert.match(page, /wordDownloadName/);
  assert.match(page, /pages converted/);
  assert.match(page, /The original PDF is still here/);
});

test("PDF tools do not block on page previews before options", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    "../components/simple-pdf-tool-page.tsx",
    "../components/pdf-lazy-previews.tsx",
    "../app/pdf-tools/sign/page.tsx",
    "../app/pdf-tools/grayscale/page.tsx",
    "../app/pdf-tools/pdf-to-word/page.tsx",
    "../app/pdf-tools/pdf-to-text/page.tsx",
    "../app/pdf-tools/pdf-to-images/page.tsx",
    "../app/pdf-tools/watermark/page.tsx",
    "../app/pdf-tools/organise/page.tsx",
    "../app/pdf-tools/edit/page.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Creating preview \$\{page\} of \$\{total\}/);
    assert.doesNotMatch(source, /Preparing page \$\{page\} of \$\{total\}/);
  }
  const helper = await readFile(new URL("../components/pdf-lazy-previews.tsx", import.meta.url), "utf8");
  assert.match(helper, /Show page previews/);
  assert.match(helper, /if \(previewState !== "loading"\) return null/);
  assert.match(helper, /options\?\.maxWidth/);
  const simple = await readFile(new URL("../components/simple-pdf-tool-page.tsx", import.meta.url), "utf8");
  assert.match(simple, /mode === "crop" \? \{ maxWidth: 900 \}/);
  assert.match(simple, /if \(mode === "crop"\) \{/);
  assert.match(simple, /showsVisualPages && mode !== "crop"/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /100cqh/);
  assert.match(css, /\.crop-preview-page > img \{[^}]*object-fit:\s*fill/);
  const watermark = await readFile(new URL("../app/pdf-tools/watermark/page.tsx", import.meta.url), "utf8");
  assert.match(watermark, /watermarkDownloadName/);
  assert.match(watermark, /toggleWatermarkPage/);
  assert.match(watermark, /Watermark \$\{pageSelection\.pages\.length\}/);
  assert.match(watermark, /The original PDF is still here/);
  const organise = await readFile(new URL("../app/pdf-tools/organise/page.tsx", import.meta.url), "utf8");
  assert.match(organise, /thumbnail: ""/);
  assert.match(organise, /Insert blank A4/);
  assert.match(organise, /duplicatePage/);
  assert.match(organise, /organiseDownloadName/);
  assert.match(organise, /onDuplicate/);
  const edit = await readFile(new URL("../app/pdf-tools/edit/page.tsx", import.meta.url), "utf8");
  assert.match(edit, /thumbnail: ""/);
});

test("PDF OCR includes copy text and searchable PDF on one page", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/pdf-to-text/page.tsx", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../src/lib/pdf-tool-catalog.ts", import.meta.url), "utf8");
  const redirect = await readFile(new URL("../app/pdf-tools/searchable-pdf/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Copy text/);
  assert.match(page, /Save searchable PDF/);
  assert.match(page, /ocrDownloadBase/);
  assert.match(page, /The original scan is still here/);
  assert.match(page, /pages read/);
  assert.match(page, /pdf: true/);
  assert.doesNotMatch(page, /searchableOnly/);
  assert.match(catalog, /Extract text or save a searchable PDF/);
  assert.doesNotMatch(catalog, /href: "\/pdf-tools\/searchable-pdf"/);
  assert.match(redirect, /redirect\("\/pdf-tools\/pdf-to-text"\)/);
});

test("Edit PDF redacts by flattening marked pages", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/edit/page.tsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("../src/lib/pdf-editor.ts", import.meta.url), "utf8");
  assert.match(page, /label: "Redact"/);
  assert.match(page, /replacePdfPagesWithImages/);
  assert.match(page, /rasterizePdfPages/);
  assert.match(page, /editDownloadName/);
  assert.match(page, /Undo last mark/);
  assert.match(page, /The original PDF is still here/);
  assert.doesNotMatch(page, /whiteout/);
  assert.match(editor, /kind === "redact"/);
  assert.match(editor, /replacePdfPagesWithImages/);
});

test("Merge PDF accepts images as well as PDFs", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/merge/page.tsx", import.meta.url), "utf8");
  assert.match(page, /imageToSinglePagePdf/);
  assert.match(page, /Choose PDFs or images/);
  assert.match(page, /FILE_ACCEPT/);
  assert.doesNotMatch(page, /Choose one or more PDF files/);
});

test("Merge PDF keeps good files, sorts by name, and names the download", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/pdf-tools/merge/page.tsx", import.meta.url), "utf8");
  assert.match(page, /skippedAdditions/);
  assert.match(page, /reason: \/encrypted\/i\.test\(message\) \? "password" : "unreadable"/);
  assert.doesNotMatch(page, /setWork\(\{ kind: "error", message: readablePdfError\(error, file\.name\) \}\);\s*return;/);
  assert.match(page, /compareFileNamesNaturally/);
  assert.match(page, /numeric:\s*true/);
  assert.match(page, /Sort by name/);
  assert.match(page, /mergeDownloadName/);
  assert.match(page, /Merged PDF file name/);
  assert.match(page, /savePdfToolHandoff/);
  assert.match(page, /pdf-tools\/unlock/);
});

test("natural filename sort keeps 2 before 10", () => {
  const names = ["10.pdf", "2.pdf", "1.pdf"];
  names.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  assert.deepEqual(names, ["1.pdf", "2.pdf", "10.pdf"]);
});


test("on-device extractive summary picks key sentences offline", () => {
  const text = [
    "DearPDF keeps documents on your device.",
    "Cloud converters upload files to remote servers for processing.",
    "An on-device summary scores sentences without leaving the browser.",
    "Users can download the result as a plain text file.",
    "Scanned image PDFs are OCR’d automatically inside the summary tool when the text layer is thin.",
    "Short, medium, and long lengths change how many points are kept.",
    "Privacy is the product, not an afterthought.",
    "Nothing about the PDF content is sent to a language model API.",
  ].join(" ");
  const sentences = splitSentences(text);
  assert.ok(sentences.length >= 6);
  const summary = summarizeExtractive(text, "short");
  assert.ok(summary.bullets.length >= 2);
  assert.ok(summary.paragraph.length > 20);
  assert.match(summary.fullText, /On-device summary/);
  assert.match(summary.fullText, /scores important sentences on this device/i);
});

test("summary repairs hyphenation and rejects mid-phrase fragments", () => {
  const broken = [
    "A Government servant may apply for leave.",
    "Govern-",
    "ment servant OR Government servant's spouse, by blood or",
    "adoption, is eligible for the concession under these rules.",
    "The competent authority shall sanction leave according to the rules.",
  ].join("\n");
  const repaired = repairPdfText(broken);
  assert.match(repaired, /Government servant/);
  assert.doesNotMatch(repaired, /Govern-\s*ment/);

  assert.equal(
    isUsableSummarySentence("servant OR Government servant's spouse, by blood or"),
    false,
  );
  assert.equal(
    isUsableSummarySentence(
      "A Government servant may apply for leave on medical certificate under these rules.",
    ),
    true,
  );

  const summary = summarizeExtractive(broken, "medium");
  for (const bullet of summary.bullets) {
    assert.doesNotMatch(bullet, /by blood or\s*$/i);
    assert.doesNotMatch(bullet, /^servant OR/i);
  }
  assert.ok(summary.bullets.length >= 1);
  assert.ok(summary.paragraph.length > 30);
});

test("summary demotes WHEREAS / bare Dated openers and shapes bullets", () => {
  assert.equal(isLegalPreambleOrBoilerplate("AND WHEREAS several workers were engaged through the agency."), true);
  assert.equal(isLegalPreambleOrBoilerplate("Dated 30.03.2026 directing the agency."), true);
  assert.equal(
    isLegalPreambleOrBoilerplate(
      "The Institute shall engage workers only through an approved agency under these rules.",
    ),
    false,
  );

  const shaped = shapeBulletText(
    "AND WHEREAS several workers were engaged through the agency for campus maintenance.",
  );
  assert.doesNotMatch(shaped, /^AND WHEREAS/i);
  assert.match(shaped, /^Several workers/i);

  const legalDoc = [
    "NOTIFICATION",
    "National Institute of Technology Order on Outsourcing.",
    "AND WHEREAS several workers were engaged through the agency for sanitation duties.",
    "AND WHEREAS several workers were engaged through the agency for horticulture duties.",
    "Dated 30.03.2026 directing the agency.",
    "NOW THEREFORE the Director hereby orders as follows.",
    "The Institute shall engage contract workers only through an approved agency.",
    "The agency shall ensure minimum wages and statutory benefits for all deployed workers.",
    "The competent authority may terminate the contract for repeated non-compliance.",
    "This order comes into force with immediate effect and supersedes earlier circulars.",
  ].join(" ");

  const summary = summarizeExtractive(legalDoc, "medium");
  assert.ok(summary.bullets.length >= 2);
  for (const bullet of summary.bullets) {
    assert.doesNotMatch(bullet, /^AND WHEREAS/i);
    assert.doesNotMatch(bullet, /^WHEREAS/i);
    assert.doesNotMatch(bullet, /^NOW THEREFORE/i);
    assert.doesNotMatch(bullet, /^Dated\s+\d/i);
  }
  // Prefer action sentences over recital collage
  const joined = summary.bullets.join(" ");
  assert.match(joined, /shall|may|comes into force|ensure/i);
  // Overview should not lead with abrupt legal openers
  assert.doesNotMatch(summary.paragraph, /^(AND WHEREAS|WHEREAS|Dated)\b/i);
  assert.ok(summary.paragraph.length > 40);
});

test("summary cleans dual-column OM amendment tables and rejects letterhead dumps", () => {
  const omTableDoc = [
    "F.NO.2/6/2026-PPD(I)",
    "Government of India",
    "Ministry of Finance",
    "Department of Expenditure",
    "Office Memorandum",
    "Subject: Amendment to General Financial Rules regarding debarment of bidders.",
    "(2) failure to remit statutory contributions due to default by the bidder.",
    "Existing Rule ) Amended Rule ) contributions due to default by the | bidder.",
    "DoE shall maintain a list of (DoE) will maintain such list which will | such debarred bidders which shall also also be displayed on the Central Public | be displayed on GeM.",
    "The Ministry/ Department will bi such list which will also be displayed on | their website.",
    "Debarment proceedings may be initiated by the procuring entity for repeated defaults under these rules.",
    "This OM comes into force with immediate effect and amends the relevant GFR provisions on bidder debarment.",
  ].join("\n");

  const cleaned = preCleanDocumentText(omTableDoc);
  assert.doesNotMatch(cleaned, /\|/);
  assert.doesNotMatch(cleaned, /Existing\s+Rule/i);
  assert.doesNotMatch(cleaned, /Amended\s+Rule/i);
  assert.doesNotMatch(cleaned, /\balso\s+also\b/i);
  assert.match(cleaned, /will be /i);

  assert.equal(
    shouldRejectAsBullet("Existing Rule ) Amended Rule ) contributions due to default by the | bidder."),
    true,
  );
  assert.equal(shouldRejectAsBullet("F.NO.2/6/2026-PPD(I) Government of India Ministry of Finance"), true);

  const shapedGround = shapeBulletText(
    "(2) failure to remit statutory contributions due to default by the bidder.",
  );
  assert.doesNotMatch(shapedGround, /^\(2\)/);
  assert.match(shapedGround, /debarment|Among other grounds/i);
  assert.match(shapedGround, /statutory/i);

  const summary = summarizeExtractive(omTableDoc, "medium");
  assert.ok(summary.bullets.length >= 2);
  assert.ok(summary.bullets.length <= 7);
  for (const bullet of summary.bullets) {
    assert.doesNotMatch(bullet, /\|/);
    assert.doesNotMatch(bullet, /Existing\s+Rule/i);
    assert.doesNotMatch(bullet, /Amended\s+Rule/i);
    assert.doesNotMatch(bullet, /^\(2\)\s+failure/i);
    assert.doesNotMatch(bullet, /^F\.?\s*NO/i);
    assert.doesNotMatch(bullet, /\balso\s+also\b/i);
  }
  assert.doesNotMatch(summary.paragraph, /^F\.?\s*NO/i);
  assert.doesNotMatch(summary.paragraph, /\|/);
  assert.doesNotMatch(summary.paragraph, /Existing\s+Rule/i);
  // Overview should describe the OM / amendment, not dump the file number
  assert.match(summary.paragraph, /amendment|debarment|procurement|GFR|Office Memorandum|Ministry|Department/i);
  const joined = summary.bullets.join(" ");
  assert.match(joined, /debar|statutory|DoE|GeM|Ministry|procuring|GFR|force/i);
  assert.match(joined, /Among other grounds|debarment can follow|statutory contributions/i);
  assert.match(joined, /DoE will maintain|debarred bidders/i);
});

