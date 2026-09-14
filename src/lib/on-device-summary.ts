/**
 * On-device extractive PDF summary (TextRank-style sentence scoring).
 * Runs entirely in the browser — no cloud LLM, no model download.
 */

export type SummaryLength = "short" | "medium" | "long";

export type ExtractiveSummary = {
  /** Ordered bullet points (key sentences). */
  bullets: string[];
  /** Short prose paragraph built from the same sentences. */
  paragraph: string;
  sentenceCount: number;
  selectedCount: number;
  wordCount: number;
  /** Combined downloadable text. */
  fullText: string;
};

const STOPWORDS = new Set(
  `
  a about above after again against all am an and any are as at be because been
  before being below between both but by can could did do does doing down during
  each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no
  nor not of off on once only or other our ours ourselves out over own same she
  should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when
  where which while who whom why will with you your yours yourself yourselves
  also may might must shall upon via per etc
  `.trim().split(/\s+/),
);

const DANGLING_END =
  /\b(or|and|but|by|of|to|for|with|the|a|an|in|on|as|at|from|under|between|such|which|who|whom|that|whose|into|onto|upon|via|per|nor|either|neither|whether|including|namely|i\.e|e\.g)\s*[,:;-]?\s*$/i;

const WEAK_START =
  /^(or|and|but|by|of|to|for|with|the|a|an|in|on|as|at|from|under|between|such|which|who|whom|that|whose|into|onto|upon|via|per|nor|including|namely)\b/i;

/** Repair PDF line-break hyphenation and soft-wraps into readable prose. */
export function repairPdfText(text: string): string {
  let s = text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  // Join hyphenated words split across a line break: "Govern-\nment" → "Government"
  s = s.replace(/([A-Za-zÀ-ž\u0900-\u097f])-\s*\n\s*([A-Za-zÀ-ž\u0900-\u097f])/g, "$1$2");
  // Soft-join single newlines (keep blank lines as paragraph breaks)
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  s = s.replace(/([^\n])\n(?!\n)/g, "$1 ");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function normalizeWhitespace(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitOnSentenceBoundaries(block: string): string[] {
  // Avoid lookbehind for broader Safari support — scan for .!? followed by space + capital/quote.
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    // Legal / rules docs often use ; between clauses — treat as soft boundary when followed by capital.
    const isHard = /[.!?…।؟۔]/.test(ch);
    const isSoftSemi = ch === ";" || ch === ":";
    if (!isHard && !isSoftSemi) continue;

    let j = i + 1;
    while (j < block.length && /[)"'\]\u201d\u2019]/.test(block[j])) j += 1;
    if (j >= block.length) {
      out.push(block.slice(start).trim());
      start = block.length;
      break;
    }
    if (!/\s/.test(block[j])) continue;
    let k = j;
    while (k < block.length && /\s/.test(block[k])) k += 1;
    const next = block[k];
    if (!next) continue;

    const nextLooksNew =
      /[A-ZÀ-ÖØ-ÞĀ-žΑ-ΩА-Я“"'(0-9\u0900-\u097f]/.test(next) ||
      ch === "।" ||
      ch === "؟" ||
      ch === "۔";

    // Soft ;/: only split when the next token looks like a new sentence/clause start
    // and the piece so far is long enough to stand alone.
    if (isSoftSemi) {
      const pieceSoFar = block.slice(start, j).trim();
      if (!nextLooksNew || pieceSoFar.length < 48) continue;
      // Prefer not to split after short labels like "Note:" / "Rule 12:"
      if (/^(note|rule|section|clause|article|sub-?rule|explanation|proviso)\b/i.test(pieceSoFar) && pieceSoFar.length < 80) {
        continue;
      }
    } else if (!nextLooksNew) {
      continue;
    }

    const piece = block.slice(start, j).trim();
    if (piece) out.push(piece);
    start = k;
    i = k - 1;
  }
  const tail = block.slice(start).trim();
  if (tail) out.push(tail);
  return out.length ? out : [block.trim()].filter(Boolean);
}

function looksLikeHeading(sentence: string): boolean {
  const t = sentence.trim();
  if (t.length < 8) return true;
  if (t.length > 120) return false;
  // ALL CAPS short titles
  if (/[A-Za-z]/.test(t) && t === t.toUpperCase() && t.length < 90) return true;
  // Numbered bare headings without a real predicate
  if (/^(\d+[\).]|[IVXLC]+\.|[A-Z]\))\s+\S.{0,60}$/.test(t) && !/[.!?।]/.test(t)) return true;
  // Title-ish: few words, no verb-ish ending punctuation
  const words = t.split(/\s+/);
  if (words.length <= 6 && !/[.!?…।]/.test(t) && !/\b(is|are|shall|may|must|means|includes|means)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Prefer complete, coherent sentences; reject mid-phrase fragments. */
export function isUsableSummarySentence(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (t.length < 28) return false;
  if (looksLikeHeading(t)) return false;
  if (/^[a-zà-öø-ÿ]/.test(t)) return false;
  if (WEAK_START.test(t) && !/^[A-Z]/.test(t)) return false;
  // Starts with dangling connector even if capitalised oddly: "OR Government…"
  if (/^(OR|AND|BUT)\s/.test(t) && t.length < 100) return false;
  if (DANGLING_END.test(t)) return false;
  // Truncated mid-word / mid-phrase markers
  if (/[—–-]\s*$/.test(t)) return false;
  if (/\b(spouse|servant|employee|member),?\s+by\s+blood\s+or\s*$/i.test(t)) return false;

  const endsWell = /[.!?…।؟۔]["')\]]*$/.test(t) || /;[\"')\]]*$/.test(t);
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;

  // Allow long coherent clauses without terminal punctuation (common in OCR/legal wraps)
  if (!endsWell && words.length < 14) return false;
  if (!endsWell && DANGLING_END.test(t.replace(/[,:]+$/, ""))) return false;

  return true;
}

function sentenceQualityBonus(sentence: string, tokenCount: number): number {
  let bonus = 1;
  const t = sentence.trim();
  if (/[.!?…।؟۔]["')\]]*$/.test(t)) bonus *= 1.25;
  else if (/;[\"')\]]*$/.test(t)) bonus *= 1.08;
  else bonus *= 0.72;

  if (looksLikeHeading(t)) bonus *= 0.35;
  if (DANGLING_END.test(t)) bonus *= 0.2;
  if (/^[a-z]/.test(t)) bonus *= 0.25;

  // Prefer longer coherent sentences for legal/rules docs
  if (tokenCount >= 10 && tokenCount <= 45) bonus *= 1.15;
  else if (tokenCount < 6) bonus *= 0.45;
  else if (tokenCount > 55) bonus *= 0.85;

  return bonus;
}

export function splitSentences(text: string): string[] {
  const repaired = repairPdfText(text);
  const cleaned = normalizeWhitespace(repaired);
  if (!cleaned) return [];

  const chunks = cleaned
    .split(/\n{2,}/)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (!trimmed) return [];
      // Short heading-only blocks: keep only if they look like real content later filters will drop
      if (trimmed.length < 40 && !/[.!?।;:]/.test(trimmed)) {
        return [trimmed];
      }
      return splitOnSentenceBoundaries(trimmed);
    })
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20 || /[A-Za-zÀ-ž]{4,}/.test(s));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const sentence of chunks) {
    const key = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    // Near-duplicate: same first ~12 significant chars already kept
    let nearDup = false;
    for (const prev of seen) {
      if (prev.length < 24 || key.length < 24) continue;
      const a = prev.slice(0, 48);
      const b = key.slice(0, 48);
      if (a === b || (prev.includes(key.slice(0, 36)) && Math.abs(prev.length - key.length) < 40)) {
        nearDup = true;
        break;
      }
    }
    if (nearDup) continue;
    seen.add(key);
    deduped.push(sentence);
  }
  return deduped;
}

function tokenize(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\u0d00-\u0d7f\s'-]+/gi, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function targetSentenceCount(length: SummaryLength, available: number): number {
  if (available <= 1) return available;
  const ratio = length === "short" ? 0.12 : length === "medium" ? 0.22 : 0.35;
  const floor = length === "short" ? 3 : length === "medium" ? 5 : 8;
  const ceil = length === "short" ? 6 : length === "medium" ? 10 : 16;
  return Math.max(1, Math.min(available, Math.max(floor, Math.min(ceil, Math.round(available * ratio)))));
}

/**
 * Score sentences with TF-IDF cosine similarity (TextRank-lite) plus
 * mild position and length bonuses. Always offline.
 */
export function summarizeExtractive(
  rawText: string,
  length: SummaryLength = "medium",
): ExtractiveSummary {
  const allSentences = splitSentences(rawText);
  const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;

  // Prefer complete sentences; fall back to broader pool if filtering is too aggressive.
  let sentences = allSentences.filter(isUsableSummarySentence);
  if (sentences.length < 3 && allSentences.length >= 3) {
    sentences = allSentences.filter((s) => {
      const t = s.trim();
      return t.length >= 24 && !DANGLING_END.test(t) && !/^[a-z]/.test(t);
    });
  }
  if (!sentences.length) sentences = allSentences;

  if (!sentences.length) {
    return {
      bullets: [],
      paragraph: "",
      fullText: "",
      sentenceCount: 0,
      selectedCount: 0,
      wordCount,
    };
  }

  if (sentences.length === 1) {
    const only = sentences[0];
    return {
      bullets: [only],
      paragraph: only,
      fullText: formatSummaryOutput([only], only),
      sentenceCount: 1,
      selectedCount: 1,
      wordCount,
    };
  }

  const tokens = sentences.map(tokenize);
  const df = new Map<string, number>();
  for (const toks of tokens) {
    for (const term of new Set(toks)) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const n = sentences.length;
  const vectors = tokens.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of tf) {
      const idf = Math.log((1 + n) / (1 + (df.get(term) || 0))) + 1;
      const weight = (count / Math.max(1, toks.length)) * idf;
      vec.set(term, weight);
      norm += weight * weight;
    }
    return { vec, norm: Math.sqrt(norm) || 1 };
  });

  const scores = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = vectors[i];
      const b = vectors[j];
      let dot = 0;
      const [smaller, larger] = a.vec.size <= b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
      for (const [term, weight] of smaller) {
        const other = larger.get(term);
        if (other) dot += weight * other;
      }
      const sim = dot / (a.norm * b.norm);
      if (sim > 0.05) {
        scores[i] += sim;
        scores[j] += sim;
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    const position = i / Math.max(1, n - 1);
    const positionBoost =
      1 + 0.35 * (1 - Math.abs(position - 0.15)) + 0.15 * (position > 0.85 ? 1 : 0);
    const len = tokens[i].length;
    const lengthPenalty = len < 4 ? 0.45 : len > 50 ? 0.7 : 1;
    scores[i] = scores[i] * positionBoost * lengthPenalty * sentenceQualityBonus(sentences[i], len);
  }

  const k = targetSentenceCount(length, n);
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: number[] = [];
  for (const candidate of ranked) {
    if (picked.length >= k) break;
    if (candidate.score <= 0 && picked.length >= Math.min(2, k)) continue;
    const candTokens = new Set(tokens[candidate.index]);
    const tooSimilar = picked.some((idx) => {
      const other = tokens[idx];
      if (!other.length || !candTokens.size) return false;
      let overlap = 0;
      for (const t of other) if (candTokens.has(t)) overlap += 1;
      const denom = Math.min(other.length, candTokens.size);
      return denom > 0 && overlap / denom > 0.65;
    });
    if (!tooSimilar) picked.push(candidate.index);
  }

  // Keep reading order for bullets and paragraph (coherent legal narrative).
  const inOrder = [...picked].sort((a, b) => a - b);
  const bullets = inOrder.map((i) => sentences[i]);
  const paragraph = bullets.join(" ");

  return {
    bullets,
    paragraph,
    fullText: formatSummaryOutput(bullets, paragraph),
    sentenceCount: n,
    selectedCount: bullets.length,
    wordCount,
  };
}

function formatSummaryOutput(bullets: string[], paragraph: string) {
  const lines = [
    "On-device summary",
    "Private summary (runs in your browser)",
    "",
    "Key points",
    ...bullets.map((b) => `• ${b}`),
    "",
    "Summary",
    paragraph,
    "",
  ];
  return lines.join("\n");
}

/** Extract readable lines from pdf.js text items (same approach as PDF OCR). */
export function extractLinesFromTextItems(items: ArrayLike<unknown> | null | undefined) {
  const lines: string[] = [];
  let currentY: number | null = null;
  let line = "";
  for (const item of Array.from(items ?? [])) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) continue;
    const textItem = item as { str: string; transform: number[] };
    const y = textItem.transform[5];
    if (currentY !== null && Math.abs(y - currentY) > 3) {
      if (line.trim()) lines.push(line.trim());
      line = "";
    }
    line += `${line ? " " : ""}${textItem.str}`;
    currentY = y;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

/** Characters of non-whitespace text — used to decide when OCR is needed. */
export function textLayerDensity(text: string): number {
  return text.replace(/\s/g, "").length;
}
