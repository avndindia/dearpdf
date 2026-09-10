import { strToU8, zipSync } from "fflate";

export type EditableDocxPage = {
  pageNumber: number;
  lines?: string[];
  blocks?: EditableDocxBlock[];
  widthPoints?: number;
  heightPoints?: number;
};

export type EditableDocxRun = {
  text: string;
  breakBefore?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
};

export type EditableDocxParagraph = {
  kind: "paragraph";
  runs: EditableDocxRun[];
  alignment?: "left" | "center" | "right" | "justify";
  leftIndent?: number;
  spacingAfter?: number;
};

export type EditableDocxTable = {
  kind: "table";
  rows: Array<Array<{ runs: EditableDocxRun[] }>>;
  columnWidths?: number[];
  borders?: boolean;
};

export type EditableDocxBlock = EditableDocxParagraph | EditableDocxTable;

export type EditableDocxOptions = {
  title?: string;
  creator?: string;
  includePageLabels?: boolean;
};

function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(text: string, style?: "PageLabel") {
  const preserveSpace = /^\s|\s$|\s{2,}/.test(text) ? ' xml:space="preserve"' : "";
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t${preserveSpace}>${xml(text)}</w:t></w:r></w:p>`;
}

function runXml(run: EditableDocxRun) {
  const properties = [
    run.bold ? "<w:b/>" : "",
    run.italic ? "<w:i/>" : "",
    run.underline ? '<w:u w:val="single"/>' : "",
    run.fontSize ? `<w:sz w:val="${Math.max(2, Math.round(run.fontSize * 2))}"/><w:szCs w:val="${Math.max(2, Math.round(run.fontSize * 2))}"/>` : "",
    run.fontFamily ? `<w:rFonts w:ascii="${xml(run.fontFamily)}" w:hAnsi="${xml(run.fontFamily)}" w:cs="${xml(run.fontFamily)}"/>` : "",
  ].join("");
  const preserveSpace = /^\s|\s$|\s{2,}/.test(run.text) ? ' xml:space="preserve"' : "";
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${run.breakBefore ? "<w:br/>" : ""}<w:t${preserveSpace}>${xml(run.text)}</w:t></w:r>`;
}

function formattedParagraph(block: EditableDocxParagraph) {
  const properties = [
    block.alignment && block.alignment !== "left" ? `<w:jc w:val="${block.alignment === "justify" ? "both" : block.alignment}"/>` : "",
    block.leftIndent && block.alignment !== "center" && block.alignment !== "right"
      ? `<w:ind w:left="${Math.max(0, Math.round(block.leftIndent * 20))}"/>`
      : "",
    `<w:spacing w:before="0" w:after="${Math.max(0, Math.round((block.spacingAfter || 0) * 20))}"/>`,
  ].join("");
  return `<w:p><w:pPr>${properties}</w:pPr>${block.runs.map(runXml).join("")}</w:p>`;
}

function tableXml(block: EditableDocxTable, pageWidthPoints: number) {
  const columns = Math.max(1, ...block.rows.map((row) => row.length));
  const availableWidth = Math.max(72, pageWidthPoints - 72);
  const suppliedWidths = block.columnWidths?.length === columns
    ? block.columnWidths
    : Array.from({ length: columns }, () => availableWidth / columns);
  const total = suppliedWidths.reduce((sum, width) => sum + Math.max(1, width), 0);
  const widths = suppliedWidths.map((width) => Math.round(Math.max(1, width) / total * availableWidth * 20));
  const borders = block.borders
    ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="A0A0A0"/><w:insideV w:val="single" w:sz="4" w:color="A0A0A0"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  const rows = block.rows.map((row) => {
    const cells = Array.from({ length: columns }, (_, index) => {
      const cell = row[index];
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${cell ? cell.runs.map(runXml).join("") : ""}</w:p></w:tc>`;
    }).join("");
    return `<w:tr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;
}

function sectionProperties(page: EditableDocxPage, type?: "nextPage") {
  const width = Math.round((page.widthPoints || 595.3) * 20);
  const height = Math.round((page.heightPoints || 841.9) * 20);
  const orientation = width > height ? ' w:orient="landscape"' : "";
  return `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ""}<w:pgSz w:w="${width}" w:h="${height}"${orientation}/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
}

export function createEditableDocx(
  pages: EditableDocxPage[],
  options: EditableDocxOptions = {},
): Uint8Array {
  if (!pages.length) throw new Error("No pages were supplied for the Word document.");
  if (pages.every((page) =>
    !(page.lines || []).some((line) => line.trim()) &&
    !(page.blocks || []).some((block) =>
      block.kind === "paragraph"
        ? block.runs.some((run) => run.text.trim())
        : block.rows.some((row) => row.some((cell) => cell.runs.some((run) => run.text.trim())))
    )
  )) {
    throw new Error("No text was found for the Word document.");
  }

  const body = pages.map((page, index) => {
    const pageWidth = page.widthPoints || 595.3;
    const blocks = page.blocks?.length
      ? page.blocks.map((block) => block.kind === "paragraph"
          ? formattedParagraph(block)
          : tableXml(block, pageWidth))
      : (page.lines || []).map((line) => paragraph(line));
    const content = [
      options.includePageLabels ? paragraph(`Page ${page.pageNumber}`, "PageLabel") : "",
      ...blocks,
    ].join("");
    const sectionBreak = index < pages.length - 1
      ? `<w:p><w:pPr>${sectionProperties(page, "nextPage")}</w:pPr></w:p>`
      : "";
    return `${content}${sectionBreak}`;
  }).join("");
  const lastPage = pages[pages.length - 1];

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    ${sectionProperties(lastPage)}
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Nirmala UI"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="PageLabel">
    <w:name w:val="Page label"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="0" w:after="180"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="555555"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
  </w:style>
</w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const now = new Date().toISOString();
  const coreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(options.title || "Converted PDF")}</dc:title>
  <dc:creator>${xml(options.creator || "DearPDF")}</dc:creator>
  <cp:lastModifiedBy>${xml(options.creator || "DearPDF")}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const appProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>DearPDF</Application>
  <Pages>${pages.length}</Pages>
</Properties>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(stylesXml),
    "word/_rels/document.xml.rels": strToU8(documentRelationships),
    "docProps/core.xml": strToU8(coreProperties),
    "docProps/app.xml": strToU8(appProperties),
  }, { level: 6 });
}
