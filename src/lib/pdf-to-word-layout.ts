import type {
  EditableDocxBlock,
  EditableDocxParagraph,
  EditableDocxRun,
  EditableDocxTable,
} from "./docx";

export type PositionedText = {
  y: number;
  x: number;
  text: string;
  width: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  underline: boolean;
};

export type HorizontalRule = { x1: number; x2: number; y: number };
export type VerticalRule = { x: number; y1: number; y2: number };

export type PdfStructNode = {
  role?: string;
  type?: string;
  id?: string;
  children?: PdfStructNode[];
};

export type ListKind = "bullet" | "decimal" | "alpha" | "roman";

type Line = { y: number; items: PositionedText[] };

export function clusterValues(values: number[], tolerance: number): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]]];
  for (let index = 1; index < sorted.length; index += 1) {
    const group = groups[groups.length - 1];
    if (sorted[index] - group[group.length - 1] <= tolerance) group.push(sorted[index]);
    else groups.push([sorted[index]]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

export function positionedText(
  item: unknown,
  styles: Record<string, { fontFamily?: string }>,
): PositionedText | null {
  if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return null;
  const textItem = item as { str: string; transform: number[]; width?: number; height?: number; fontName?: string };
  if (!textItem.str.trim()) return null;
  const fontName = textItem.fontName || "";
  const family = styles[fontName]?.fontFamily || "";
  return {
    y: textItem.transform[5],
    x: textItem.transform[4],
    text: textItem.str,
    width: textItem.width || 0,
    fontSize: Math.hypot(textItem.transform[0] || 0, textItem.transform[1] || 0) || textItem.height || 11,
    fontName,
    fontFamily: family.replace(/^[A-Z]{6}\+/, ""),
    underline: false,
  };
}

export function applyDetectedUnderlines(
  items: PositionedText[],
  horizontalRules: HorizontalRule[],
) {
  items.forEach((item) => {
    item.underline = horizontalRules.some((rule) =>
      rule.y <= item.y &&
      item.y - rule.y <= Math.max(5, item.fontSize * 0.45) &&
      rule.x1 <= item.x + item.width &&
      rule.x2 >= item.x
    );
  });
}

function textRun(item: PositionedText, leadingSpace = false): EditableDocxRun {
  const fontIdentity = `${item.fontName} ${item.fontFamily}`.toLowerCase();
  return {
    text: `${leadingSpace ? " " : ""}${item.text}`,
    bold: /bold|black|heavy|demi|semibold/.test(fontIdentity),
    italic: /italic|oblique/.test(fontIdentity),
    underline: item.underline || /underline/.test(fontIdentity),
    fontSize: Math.max(6, Math.min(96, item.fontSize)),
    fontFamily: item.fontFamily || undefined,
  };
}

export function runsForItems(items: PositionedText[]) {
  const runs: EditableDocxRun[] = [];
  let previousEnd: number | null = null;
  items.forEach((item) => {
    const needsSpace = previousEnd !== null && item.x - previousEnd > Math.max(1.5, item.fontSize * 0.12);
    runs.push(textRun(item, needsSpace));
    previousEnd = item.x + item.width;
  });
  return runs;
}

export function linesForPositionedItems(items: PositionedText[]) {
  const sorted = [...items].sort((a, b) =>
    Math.abs(b.y - a.y) > Math.max(2.5, Math.min(a.fontSize, b.fontSize) * 0.24)
      ? b.y - a.y
      : a.x - b.x
  );
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => {
      const referenceSize = candidate.items[0]?.fontSize || item.fontSize;
      return Math.abs(candidate.y - item.y) <= Math.max(2.5, Math.min(referenceSize, item.fontSize) * 0.24);
    });
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

export function runsForMultipleLines(items: PositionedText[], forceBold = false) {
  return linesForPositionedItems(items).flatMap((line, lineIndex) =>
    runsForItems(line.items).map((run, runIndex) => ({
      ...run,
      bold: forceBold || run.bold,
      breakBefore: lineIndex > 0 && runIndex === 0,
    }))
  );
}

function nearestIndex(values: number[], value: number) {
  let best = 0;
  let bestDistance = Infinity;
  values.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function columnInterval(colXs: number[], x: number) {
  for (let index = 0; index < colXs.length - 1; index += 1) {
    if (x >= colXs[index] - 1 && x < colXs[index + 1] - 0.5) return index;
  }
  return x < colXs[0] ? 0 : Math.max(0, colXs.length - 2);
}

function rowInterval(rowYs: number[], y: number) {
  for (let index = 0; index < rowYs.length - 1; index += 1) {
    if (y <= rowYs[index] + 1 && y > rowYs[index + 1] - 0.5) return index;
  }
  return y > rowYs[0] ? 0 : Math.max(0, rowYs.length - 2);
}

function boundaryExists(
  rules: VerticalRule[],
  x: number,
  yTop: number,
  yBottom: number,
) {
  const midY = (yTop + yBottom) / 2;
  return rules.some((rule) =>
    Math.abs(rule.x - x) <= 4 &&
    Math.min(rule.y1, rule.y2) - 2 <= midY &&
    Math.max(rule.y1, rule.y2) + 2 >= midY
  );
}

export function reconstructGridTable(
  items: PositionedText[],
  horizontalRules: HorizontalRule[],
  verticalRules: VerticalRule[],
): { table: EditableDocxTable; x1: number; x2: number; y1: number; y2: number } | null {
  const colXs = clusterValues(verticalRules.map((rule) => rule.x), 3.5);
  const rowYs = clusterValues(horizontalRules.map((rule) => rule.y), 3.5).sort((a, b) => b - a);
  if (colXs.length < 3 || rowYs.length < 3) return null;

  const x1 = colXs[0];
  const x2 = colXs[colXs.length - 1];
  const y2 = rowYs[0];
  const y1 = rowYs[rowYs.length - 1];
  const tableItems = items.filter((item) =>
    item.x + item.width >= x1 - 6 &&
    item.x <= x2 + 6 &&
    item.y >= y1 - 10 &&
    item.y <= y2 + 10
  );
  if (tableItems.length < 2) return null;

  const columnCount = colXs.length - 1;
  const rowCount = rowYs.length - 1;
  const cells: PositionedText[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => [])
  );
  tableItems.forEach((item) => {
    cells[rowInterval(rowYs, item.y)][columnInterval(colXs, item.x)].push(item);
  });

  const rows = cells.map((row, rowIndex) => {
    const output: Array<{ runs: EditableDocxRun[]; gridSpan?: number }> = [];
    let column = 0;
    while (column < columnCount) {
      let span = 1;
      while (
        column + span < columnCount &&
        !boundaryExists(verticalRules, colXs[column + span], rowYs[rowIndex], rowYs[rowIndex + 1]) &&
        cells[rowIndex][column + span].length === 0
      ) {
        span += 1;
      }
      output.push({
        runs: runsForMultipleLines(cells[rowIndex][column]),
        gridSpan: span > 1 ? span : undefined,
      });
      column += span;
    }
    return output;
  });

  return {
    table: {
      kind: "table",
      rows,
      columnWidths: colXs.slice(0, -1).map((start, index) => Math.max(24, colXs[index + 1] - start)),
      borders: true,
    },
    x1,
    x2,
    y1,
    y2,
  };
}

function splitIntoCells(items: PositionedText[], columnStarts?: number[]) {
  if (columnStarts && columnStarts.length >= 2) {
    const cells: PositionedText[][] = Array.from({ length: columnStarts.length }, () => []);
    items.forEach((item) => {
      cells[nearestIndex(columnStarts, item.x)].push(item);
    });
    return cells;
  }
  const cells: PositionedText[][] = [];
  let current: PositionedText[] = [];
  let previousEnd: number | null = null;
  items.forEach((item) => {
    const gap = previousEnd === null ? 0 : item.x - previousEnd;
    const threshold = Math.max(14, item.fontSize * 1.6);
    if (current.length && gap > threshold) {
      cells.push(current);
      current = [];
    }
    current.push(item);
    previousEnd = item.x + item.width;
  });
  if (current.length) cells.push(current);
  return cells;
}

function columnStartsForLines(lines: Line[]) {
  const starts = clusterValues(lines.flatMap((line) => line.items.map((item) => item.x)), 14);
  return starts.length >= 2 ? starts : [];
}

function lineUsesColumns(line: Line, columnStarts: number[]) {
  const used = new Set(line.items.map((item) => nearestIndex(columnStarts, item.x)));
  return used.size >= 2;
}

function tableFromAlignedLines(lines: Line[]): EditableDocxTable | null {
  if (lines.length < 2) return null;
  const columnStarts = columnStartsForLines(lines);
  if (columnStarts.length < 2) return null;
  const tabularCount = lines.filter((line) => lineUsesColumns(line, columnStarts)).length;
  if (tabularCount < 2) return null;
  const rightEdge = Math.max(...lines.flatMap((line) => line.items.map((item) => item.x + item.width)));
  return {
    kind: "table",
    rows: lines.map((line) =>
      splitIntoCells(line.items, columnStarts).map((cell) => ({
        runs: runsForItems(cell),
        gridSpan: undefined,
      }))
    ),
    columnWidths: columnStarts.map((start, index) =>
      Math.max(28, (columnStarts[index + 1] ?? rightEdge + 8) - start)
    ),
    borders: false,
  };
}

export function detectListMarker(text: string): { type: ListKind; markerLength: number; rest: string } | null {
  const value = text.replace(/^\s+/, "");
  const leading = text.length - value.length;
  const bullet = value.match(/^([•·▪◦●○‣⁃]|[-–—*])\s+(.*)$/);
  if (bullet) {
    return { type: "bullet", markerLength: leading + value.length - bullet[2].length, rest: bullet[2] };
  }
  const numbered = value.match(/^(\d{1,3})[.)]\s+(.*)$/);
  if (numbered) {
    return { type: "decimal", markerLength: leading + value.length - numbered[2].length, rest: numbered[2] };
  }
  const paren = value.match(/^\(([^)]+)\)\s+(.*)$/);
  if (paren) {
    const inner = paren[1];
    const rest = paren[2];
    const type: ListKind = /^\d+$/.test(inner)
      ? "decimal"
      : /^[ivxlcdm]+$/i.test(inner) && (inner.length > 1 || /^[ivx]$/i.test(inner))
        ? "roman"
        : /^[a-z]$/i.test(inner)
          ? "alpha"
          : "decimal";
    return { type, markerLength: leading + value.length - rest.length, rest };
  }
  return null;
}

function stripPrefixFromRuns(runs: EditableDocxRun[], prefixLength: number) {
  let remaining = prefixLength;
  const next: EditableDocxRun[] = [];
  runs.forEach((run) => {
    if (remaining >= run.text.length) {
      remaining -= run.text.length;
      return;
    }
    if (remaining > 0) {
      next.push({ ...run, text: run.text.slice(remaining) });
      remaining = 0;
      return;
    }
    next.push(run);
  });
  return next.filter((run) => run.text.length);
}

function paragraphFromLine(
  line: Line,
  pageWidth: number,
  nextLine: Line | undefined,
): EditableDocxParagraph {
  const runs = runsForItems(line.items);
  const text = runs.map((run) => run.text).join("");
  const list = detectListMarker(text);
  const left = line.items[0].x;
  const right = Math.max(...line.items.map((item) => item.x + item.width));
  const leftGap = left;
  const rightGap = pageWidth - right;
  const centreOffset = Math.abs((left + right) / 2 - pageWidth / 2);
  const alignment = list
    ? "left"
    : centreOffset <= 12 && leftGap > 24 && rightGap > 24
      ? "center"
      : rightGap <= 36 && leftGap > rightGap * 1.8
        ? "right"
        : right - left >= pageWidth * 0.72
          ? "justify"
          : "left";
  const fontSize = Math.max(...line.items.map((item) => item.fontSize));
  const baselineGap = nextLine ? line.y - nextLine.y : fontSize * 1.4;
  return {
    kind: "paragraph",
    runs: list ? stripPrefixFromRuns(runs, list.markerLength) : runs,
    alignment,
    leftIndent: alignment === "left" && !list ? Math.max(0, left - 36) : 0,
    spacingAfter: Math.max(0, Math.min(24, baselineGap - fontSize * 1.05)),
    list: list ? { type: list.type } : undefined,
  };
}

function lineInside(line: Line, box: { x1: number; x2: number; y1: number; y2: number }) {
  return line.y <= box.y2 + 8 && line.y >= box.y1 - 8 &&
    line.items.some((item) => item.x >= box.x1 - 12 && item.x <= box.x2 + 12);
}

export function extractFormattedPage(
  items: ArrayLike<unknown>,
  styles: Record<string, { fontFamily?: string }>,
  pageWidth: number,
  horizontalRules: HorizontalRule[],
  verticalRules: VerticalRule[] = [],
) {
  const rows: PositionedText[] = [];
  for (const item of Array.from(items)) {
    const positioned = positionedText(item, styles);
    if (positioned) rows.push(positioned);
  }
  applyDetectedUnderlines(rows, horizontalRules);
  const orderedLines = linesForPositionedItems(rows);
  const grid = reconstructGridTable(rows, horizontalRules, verticalRules);
  const blocks: EditableDocxBlock[] = [];

  for (let index = 0; index < orderedLines.length;) {
    const line = orderedLines[index];
    if (grid && lineInside(line, grid)) {
      if (!blocks.includes(grid.table)) blocks.push(grid.table);
      index += 1;
      continue;
    }

    const columnStarts = columnStartsForLines(orderedLines.slice(index, index + 8));
    const firstCells = splitIntoCells(line.items, columnStarts.length >= 2 ? columnStarts : undefined);
    if (firstCells.length >= 2 || (columnStarts.length >= 2 && lineUsesColumns(line, columnStarts))) {
      const tableLines = [line];
      let next = index + 1;
      while (next < orderedLines.length) {
        const candidate = orderedLines[next];
        if (grid && lineInside(candidate, grid)) break;
        const previous = orderedLines[next - 1];
        const typicalSize = Math.max(...previous.items.map((item) => item.fontSize));
        const verticalGap = previous.y - candidate.y;
        const aligned = columnStarts.length >= 2
          ? lineUsesColumns(candidate, columnStarts) ||
            (splitIntoCells(candidate.items, columnStarts).filter((cell) => cell.length).length >= 2)
          : splitIntoCells(candidate.items).length === firstCells.length;
        if (!aligned || verticalGap > typicalSize * 3.2) break;
        tableLines.push(candidate);
        next += 1;
      }
      const table = tableFromAlignedLines(tableLines);
      if (table && tableLines.length >= 2) {
        table.borders = verticalRules.length >= 2 && horizontalRules.length >= 2;
        blocks.push(table);
        index = next;
        continue;
      }
    }

    blocks.push(paragraphFromLine(line, pageWidth, orderedLines[index + 1]));
    index += 1;
  }

  const plainLines = blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? [block.runs.map((run) => run.text).join("").trim()]
      : block.rows.map((row) => row.map((cell) => cell.runs.map((run) => run.text).join("").trim()).join(" | "))
  ).filter(Boolean);

  return { lines: plainLines, blocks };
}

function nodeRole(node: PdfStructNode) {
  return node.role || node.type || "";
}

function descendantsWithRole(node: PdfStructNode, role: string): PdfStructNode[] {
  if (nodeRole(node) === role) return [node];
  return (node.children || []).flatMap((child) => descendantsWithRole(child, role));
}

function contentIds(node: PdfStructNode): string[] {
  const own = node.type === "content" && node.id ? [node.id] : [];
  return [...own, ...(node.children || []).flatMap(contentIds)];
}

function markedContentItems(items: ArrayLike<unknown>) {
  const byId = new Map<string, unknown[]>();
  const stack: Array<string | null> = [];
  for (const item of Array.from(items)) {
    if (!item || typeof item !== "object") continue;
    const marker = item as { type?: string; id?: string };
    if (marker.type === "beginMarkedContentProps" || marker.type === "beginMarkedContent") {
      stack.push(marker.id || null);
      continue;
    }
    if (marker.type === "endMarkedContent") {
      stack.pop();
      continue;
    }
    if (!("str" in item)) continue;
    stack.filter((id): id is string => Boolean(id)).forEach((id) => {
      const collected = byId.get(id) || [];
      collected.push(item);
      byId.set(id, collected);
    });
  }
  return byId;
}

export function extractTaggedPage(
  structure: PdfStructNode | null,
  rawItems: ArrayLike<unknown>,
  styles: Record<string, { fontFamily?: string }>,
  pageWidth: number,
  horizontalRules: HorizontalRule[],
  verticalRules: VerticalRule[] = [],
) {
  if (!structure) return null;
  const marked = markedContentItems(rawItems);
  const itemsForNode = (node: PdfStructNode) => {
    const positioned = contentIds(node)
      .flatMap((id) => marked.get(id) || [])
      .map((item) => positionedText(item, styles))
      .filter((item): item is PositionedText => Boolean(item));
    applyDetectedUnderlines(positioned, horizontalRules);
    return positioned;
  };
  const root = nodeRole(structure) === "Root"
    ? (structure.children?.[0] || structure)
    : structure;
  const blocks: EditableDocxBlock[] = [];
  const hasRulingLines = horizontalRules.length >= 2 && verticalRules.length >= 2;

  for (const node of root.children || []) {
    if (nodeRole(node) === "Table") {
      const rows = descendantsWithRole(node, "TR").map((row) =>
        (row.children || [])
          .filter((cell) => nodeRole(cell) === "TH" || nodeRole(cell) === "TD")
          .map((cell) => ({
            runs: runsForMultipleLines(itemsForNode(cell), nodeRole(cell) === "TH"),
          }))
      ).filter((row) => row.length);
      if (!rows.length) continue;
      const columnCount = Math.max(...rows.map((row) => row.length));
      const starts = Array.from({ length: columnCount }, (_, columnIndex) => {
        const candidates = descendantsWithRole(node, "TR").flatMap((row) => {
          const cell = (row.children || []).filter((child) =>
            nodeRole(child) === "TH" || nodeRole(child) === "TD"
          )[columnIndex];
          const cellItems = cell ? itemsForNode(cell) : [];
          return cellItems.length ? [Math.min(...cellItems.map((item) => item.x))] : [];
        });
        return candidates.length
          ? candidates.sort((a, b) => a - b)[Math.floor(candidates.length / 2)]
          : 36 + columnIndex * ((pageWidth - 72) / columnCount);
      });
      const tableItems = itemsForNode(node);
      const rightEdge = tableItems.length
        ? Math.max(...tableItems.map((item) => item.x + item.width))
        : pageWidth - 36;
      blocks.push({
        kind: "table",
        rows,
        columnWidths: starts.map((start, index) =>
          Math.max(30, (starts[index + 1] ?? rightEdge) - start)
        ),
        borders: hasRulingLines,
      });
      continue;
    }

    const items = itemsForNode(node);
    if (!items.length) continue;
    const lines = linesForPositionedItems(items);
    lines.forEach((line, lineIndex) => {
      blocks.push(paragraphFromLine(line, pageWidth, lines[lineIndex + 1]));
    });
  }
  if (!blocks.length) return null;
  return {
    lines: blocks.flatMap((block) =>
      block.kind === "paragraph"
        ? [block.runs.map((run) => run.text).join("").trim()]
        : block.rows.map((row) => row.map((cell) => cell.runs.map((run) => run.text).join("").trim()).join(" | "))
    ).filter(Boolean),
    blocks,
  };
}

export function blocksFromPlainLines(lines: string[]): EditableDocxBlock[] {
  return lines.map((line) => {
    const list = detectListMarker(line);
    return {
      kind: "paragraph" as const,
      runs: [{ text: list ? list.rest : line, fontSize: 11 }],
      alignment: "left" as const,
      list: list ? { type: list.type } : undefined,
    };
  });
}
