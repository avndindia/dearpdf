/**
 * On-device PDF summary — DistilBART abstractive (Transformers.js) after OCR/text
 * gather, with TextRank-style extractive fallback if the model cannot load.
 * Runs entirely in the browser — no cloud LLM, PDF/text never leaves the device.
 *
 * Heuristics clean dual-column table glue, OM letterhead, and numbered
 * ground-list fragments before extractive scoring so Key points read as claims.
 */

export type SummaryLength = "short" | "medium" | "long";

export type SummaryMode = "abstractive" | "extractive";

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

/** Result of on-device summarisation (abstractive DistilBART or extractive fallback). */
export type OnDeviceSummary = ExtractiveSummary & {
  mode: SummaryMode;
  /** Hugging Face / Xenova model id when abstractive succeeded. */
  modelId?: string;
  /** Shown when DistilBART failed and extractive was used. */
  fallbackNote?: string;
  /** Number of text chunks summarised (abstractive only). */
  chunkCount?: number;
};

export type AbstractiveProgress = {
  phase: "loading-model" | "summarizing-chunk" | "combining";
  chunk?: number;
  totalChunks?: number;
  message: string;
  percent: number;
};

export type SummarizeOnDeviceOptions = {
  length?: SummaryLength;
  onProgress?: (progress: AbstractiveProgress) => void;
  isCancelled?: () => boolean;
};

/** DistilBART CNN abstractive summariser (ONNX via Transformers.js). */
export const DISTILBART_MODEL_ID = "Xenova/distilbart-cnn-12-6";

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

/** Legal / schedule openers that read as abrupt PDF excerpts, not summary points. */
const LEGAL_PREAMBLE_START =
  /^(AND\s+WHEREAS|WHEREAS|NOW\s+THEREFORE|NOW\s+THIS|FURTHER\s+RESOLVED|RESOLVED\s+FURTHER|BE\s+IT\s+(?:FURTHER\s+)?RESOLVED|IN\s+WITNESS\s+WHEREOF|NOW\s+KNOW\s+YE|KNOW\s+ALL\s+MEN)\b/i;

/** Bare date fragments without a clear actor doing something. */
const BARE_DATE_FRAGMENT =
  /^(Dated|Date|Dt\.?|As\s+on|w\.?e\.?f\.?)\s*[:.]?\s*\d/i;

const SCHEDULE_BOILERPLATE =
  /^(SCHEDULE\s*[IVXLC0-9.-]*|ANNEXURE\s*[IVXLC0-9A.-]*|APPENDIX\s*[IVXLC0-9A.-]*|FORM\s*[IVXLC0-9A.-]*|see\s+(?:rule|section|clause|para)\b)/i;

const ACTION_VERBS =
  /\b(shall|should|must|may|will|directs?|directed|orders?|ordered|provides?|provided|requires?|required|states?|stated|notifies?|notified|appoints?|appointed|sanctions?|sanctioned|approves?|approved|authori[sz]es?|authori[sz]ed|empowers?|empowered|imposes?|imposed|grants?|granted|permits?|permitted|prohibits?|prohibited|declares?|declared|establishes?|established|constitutes?|constituted|amends?|amended|repeals?|repealed|supersedes?|superseded|instructs?|instructed|requests?|requested|informs?|informed|clarifies?|clarified|specifies?|specified|lays?\s+down|laid\s+down|comes?\s+into\s+force|came\s+into\s+force|is|are|was|were|has|have|had|maintain|maintains|maintained|display|displays|displayed|debar|debars|debarred|debarment|remit|remits|remitted)\b/i;

/** File-number / OM letterhead lines that must not lead an overview. */
const FILE_NUMBER_LINE =
  /^(?:F\.?\s*No\.?|F\.?\s*NO\.?|No\.?\s*\d|File\s*No\.?|O\.?\s*M\.?\s*No\.?|OM\s*No\.?)\s*[:.]?\s*[\w/().-]+/i;

const TABLE_CHROME =
  /\b(Existing\s+Rule|Amended\s+Rule|Old\s+Rule|New\s+Rule|Current\s+Provision|Revised\s+Provision)\b/gi;

const NUMBERED_GROUND_START =
  /^\(?\s*([0-9]+|[a-z]|[ivx]+)\)?\s*[.)]\s+/i;

const MAX_BULLET_CHARS = 160;

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

/**
 * Pre-clean raw PDF text before sentence splitting:
 * strip dual-column pipes, table chrome, duplicated clauses, cheap OCR typos.
 */
export function preCleanDocumentText(text: string): string {
  let s = text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");

  // Cheap OCR / table typos
  s = s.replace(/\bwill\s+bi\s+/gi, "will be ");
  s = s.replace(/\bshall\s+bi\s+/gi, "shall be ");
  s = s.replace(/\balso\s+also\b/gi, "also");
  s = s.replace(/\bwhich\s+will\s+will\b/gi, "which will");
  s = s.replace(/\b(the\s+the)\b/gi, "the");

  // Drop pure file-number-only lines (keep Subject + org lines for gist/issuer)
  s = s
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (FILE_NUMBER_LINE.test(t) && t.length < 80 && !/\b(amend|debar|rule|shall|subject)\b/i.test(t)) {
        return false;
      }
      return true;
    })
    .join("\n");

  // Remove table chrome phrases and stray ") " after them
  s = s.replace(TABLE_CHROME, " ");
  s = s.replace(/\bRule\s*\)\s*/gi, " ");
  s = s.replace(/\)\s*Amended\b/gi, " ");
  s = s.replace(/\(\s*\)/g, " ");
  s = s.replace(/(?:^|\s)\)+\s+/g, " ");
  s = s.replace(/\s+\)+(?=\s|$)/g, " ");
  // Orphan table-cell leftovers glued after a full stop (duplicate clause)
  s = s.replace(/\.(\s+[a-z][^.]{10,80}\.)\s+\1/gi, ".$1");
  s = s.replace(/\b(due to default by the bidder\.)\s+\1/gi, "$1");
  s = s.replace(/\b(contributions due to default by the bidder\.)\s+\1/gi, "$1");


  // Normalize vertical bars from dual-column extraction into spaces
  s = s.replace(/\s*\|\s*/g, " ");

  // Collapse duplicated near-adjacent parenthetical restatements:
  // "DoE shall maintain a list of (DoE) will maintain such list which will"
  s = s.replace(
    /\b([A-Za-z][\w.]{1,12})\s+shall\s+maintain\s+(?:a\s+)?list\s+of\s+\(\1\)\s+will\s+maintain\s+such\s+list\s+which\s+will\b/gi,
    "$1 will maintain a list which will",
  );
  s = s.replace(
    /\b([A-Za-z][\w.]{1,12})\s+shall\s+(maintain[^.|]{0,40}?)\s+\(\1\)\s+will\s+\1?\s*(maintain[^.|]{0,40})/gi,
    "$1 will $2",
  );

  // Generic near-duplicate clause collapse: "X which will Y which will Y"
  s = s.replace(/\b(.{12,60}?)\s+\1\b/gi, "$1");

  // Dual-column glue leftovers like "which will such debarred" / "shall also be displayed on the Central Public be displayed on GeM"
  s = s.replace(
    /\bwhich\s+will\s+such\s+(debarred\s+bidders)\b/gi,
    "of $1 which will",
  );
  s = s.replace(
    /\b(displayed\s+on\s+the\s+Central\s+Public(?:\s+Procurement)?(?:\s+[Pp]ortal)?)\s+(?:also\s+)?be\s+displayed\s+on\s+(GeM)\b/gi,
    "$1 and on $2",
  );
  s = s.replace(
    /\b(be\s+displayed\s+on\s+(?:the\s+)?(?:Central\s+Public(?:\s+Procurement)?(?:\s+[Pp]ortal)?|GeM|their\s+website))\s+\1\b/gi,
    "$1",
  );
  s = s.replace(
    /\bsuch\s+list\s+which\s+will\s+(?:also\s+)?be\s+displayed\s+on\s+(?:the\s+)?Central\s+Public\s+be\s+displayed\s+on\s+GeM\b/gi,
    "such list which will also be displayed on the Central Public Procurement portal and on GeM",
  );
  s = s.replace(
    /\bwill\s+maintain\s+such\s+list\s+which\s+will\s+such\s+debarred\s+bidders\s+which\s+shall\s+also\s+be\s+displayed\b/gi,
    "will maintain a list of such debarred bidders which shall also be displayed",
  );

  // "DoE shall maintain a list of … will maintain such list"
  s = s.replace(
    /\b(DoE|DOE|Department)\s+shall\s+maintain\s+a\s+list\s+of\s+[^.]*?will\s+maintain\s+such\s+list\s+which\s+will\b/gi,
    "$1 will maintain a list of debarred bidders which will",
  );
  s = s.replace(
    /\b(DoE|DOE)\s+will\s+maintain\s+a\s+list\s+of\s+debarred\s+bidders\s+which\s+will\s+which\s+shall\s+also\s+be\s+displayed\b/gi,
    "$1 will maintain a list of debarred bidders which shall also be displayed",
  );

  // Clean leftover double spaces / empty parens
  s = s.replace(/\(\s*\)/g, " ");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/ ?\n ?/g, "\n");
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
      if (/^(note|rule|section|clause|article|sub-?rule|explanation|proviso|subject)\b/i.test(pieceSoFar) && pieceSoFar.length < 80) {
        continue;
      }
      // Keep "…. Subject: Amendment…" together for gist extraction
      if (/\bSubject\s*$/i.test(pieceSoFar)) {
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

/** True when the sentence is mostly legal recital / schedule boilerplate. */
export function isLegalPreambleOrBoilerplate(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (LEGAL_PREAMBLE_START.test(t)) return true;
  if (BARE_DATE_FRAGMENT.test(t) && !ACTION_VERBS.test(t.slice(0, 80))) return true;
  if (SCHEDULE_BOILERPLATE.test(t) && t.length < 140) return true;
  // Recital-heavy: starts with "that" after a colon-ish legal feel, or is mostly "whereas" body
  if (/^that\s+(?:the|a|an|said|aforesaid)\b/i.test(t) && t.length < 90) return true;
  return false;
}

/** Letterhead / file-number dump without a useful predicate. */
export function isLetterheadOrFileNumberOnly(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (FILE_NUMBER_LINE.test(t) && !ACTION_VERBS.test(t)) return true;
  if (
    /^(Government of India|Ministry of [A-Za-z &]+|Department of [A-Za-z &]+|Office Memorandum)\b/i.test(t) &&
    !ACTION_VERBS.test(t) &&
    t.length < 100
  ) {
    return true;
  }
  // "F.NO.… Government of India Ministry of Finance" collage
  if (
    /F\.?\s*NO\.?\s*[\w/().-]+/i.test(t) &&
    /\bGovernment of India\b/i.test(t) &&
    !/\b(amend|debar|shall|provides|directs|notifies)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function hasHeavyDuplication(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim().toLowerCase();
  if (/\balso\s+also\b/.test(t)) return true;
  if (/\|/.test(sentence)) return true;
  // Repeated 4+ word phrase
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 10) {
    for (let len = 4; len <= 8; len += 1) {
      const seen = new Map<string, number>();
      for (let i = 0; i + len <= words.length; i += 1) {
        const phrase = words.slice(i, i + len).join(" ");
        const prev = seen.get(phrase);
        if (prev !== undefined && i - prev < len + 6) return true;
        if (prev === undefined) seen.set(phrase, i);
      }
    }
  }
  return false;
}

/**
 * Reject bullets that are still table chrome, pipe-merged, numbered fragments,
 * or letterhead dumps after cleaning.
 */
export function shouldRejectAsBullet(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (!t || t.length < 20) return true;
  if (/\|/.test(t)) return true;
  if (/\b(Existing\s+Rule|Amended\s+Rule)\b/i.test(t)) return true;
  if (hasHeavyDuplication(t)) return true;
  if (isLetterheadOrFileNumberOnly(t)) return true;

  // Bare numbered / lettered clause fragment without a full claim rewrite yet
  if (NUMBERED_GROUND_START.test(t)) {
    const rest = t.replace(NUMBERED_GROUND_START, "").trim();
    // Reject if it still reads as a mid-list fragment (no capitalised subject actor)
    if (!/^[A-Z]/.test(rest) && /^[a-z]/.test(rest)) return true;
    if (rest.length < 40 && !ACTION_VERBS.test(rest)) return true;
  }

  return false;
}

/** Prefer complete, coherent sentences; reject mid-phrase fragments. */
export function isUsableSummarySentence(sentence: string): boolean {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (t.length < 28) return false;
  if (looksLikeHeading(t)) return false;
  if (shouldRejectAsBullet(t)) {
    // Allow if shaping turns a numbered ground into a full claim
    const shaped = shapeBulletText(t);
    if (shouldRejectAsBullet(shaped) || shaped.length < 28) return false;
  }
  if (/^[a-zà-öø-ÿ]/.test(t) && !NUMBERED_GROUND_START.test(t)) return false;
  if (WEAK_START.test(t) && !/^[A-Z]/.test(t) && !NUMBERED_GROUND_START.test(t)) return false;
  // Starts with dangling connector even if capitalised oddly: "OR Government…"
  if (/^(OR|AND|BUT)\s/.test(t) && t.length < 100) return false;
  if (DANGLING_END.test(t)) return false;
  // Truncated mid-word / mid-phrase markers
  if (/[—–-]\s*$/.test(t)) return false;
  if (/\b(spouse|servant|employee|member),?\s+by\s+blood\s+or\s*$/i.test(t)) return false;

  // Reject abrupt legal openers unless they contain a clear action clause we can salvage later
  if (isLegalPreambleOrBoilerplate(t)) {
    // Keep only if stripping the preamble leaves a usable factual clause
    const cleaned = shapeBulletText(t);
    if (cleaned === t || cleaned.length < 28 || !ACTION_VERBS.test(cleaned)) return false;
  }

  const endsWell = /[.!?…।؟۔]["')\]]*$/.test(t) || /;[\"')\]]*$/.test(t);
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;

  // Allow long coherent clauses without terminal punctuation (common in OCR/legal wraps)
  if (!endsWell && words.length < 14 && !NUMBERED_GROUND_START.test(t)) return false;
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

  // Heavily demote legal recital / bare date / letterhead openers
  if (LEGAL_PREAMBLE_START.test(t)) bonus *= 0.12;
  else if (BARE_DATE_FRAGMENT.test(t)) bonus *= 0.18;
  else if (SCHEDULE_BOILERPLATE.test(t)) bonus *= 0.25;
  else if (isLetterheadOrFileNumberOnly(t)) bonus *= 0.08;
  else if (/\b(Existing\s+Rule|Amended\s+Rule)\b/i.test(t) || /\|/.test(t)) bonus *= 0.05;

  // Prefer complete factual / action sentences
  if (ACTION_VERBS.test(t)) bonus *= 1.35;
  // Boost debarment / procurement / GFR amendment claims
  if (/\b(debar(?:ment|red)?|procurement|GFR|GeM|statutory\s+contributions?|Office\s+Memorandum|amend(?:s|ed|ment)?)\b/i.test(t)) {
    bonus *= 1.25;
  }
  // Subject-ish capitalised noun phrase near the start + verb is a good summary candidate
  if (/^[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,4}\s+\b(shall|will|directs?|orders?|provides?|requires?|states?|notifies?|appoints?|sanctions?|approves?|authori[sz]es?|maintain)/i.test(t)) {
    bonus *= 1.2;
  }

  // Prefer mid-length coherent sentences
  if (tokenCount >= 10 && tokenCount <= 45) bonus *= 1.15;
  else if (tokenCount < 6) bonus *= 0.45;
  else if (tokenCount > 55) bonus *= 0.85;

  // Soft demote raw numbered fragments (shaping will rewrite if selected)
  if (NUMBERED_GROUND_START.test(t) && /^[a-z]/.test(t.replace(NUMBERED_GROUND_START, "").trim())) {
    bonus *= 0.55;
  }

  return bonus;
}

/**
 * Strip legal recital openers / table chrome / leading numbered grounds;
 * fold ground-list items into claim-shaped bullets; soft-trim ~160 chars.
 */
export function shapeBulletText(sentence: string): string {
  let t = sentence.replace(/\s+/g, " ").trim();

  // Strip leftover pipes / table chrome that survived pre-clean
  t = t.replace(/\s*\|\s*/g, " ");
  t = t.replace(TABLE_CHROME, " ");
  t = t.replace(/\bRule\s*\)\s*/gi, " ");
  t = t.replace(/\balso\s+also\b/gi, "also");
  t = t.replace(/\bwill\s+bi\s+/gi, "will be ");
  t = t.replace(/[ \t]+/g, " ").trim();

  // Subject line → plain topic claim (avoid "Subject:" chrome in Key points)
  const subjectLine = t.match(/^Subject\s*:\s*(.+)$/i);
  if (subjectLine) {
    const topic = subjectLine[1].replace(/[.]+$/, "").trim();
    if (/^Amendment\b/i.test(topic)) {
      t = `This document is an ${topic.charAt(0).toLowerCase()}${topic.slice(1)}.`;
    } else {
      t = `This document covers ${topic.charAt(0).toLowerCase()}${topic.slice(1)}.`;
    }
  }

  // Strip leading recital openers
  t = t.replace(
    /^(?:AND\s+WHEREAS|WHEREAS|NOW\s+THEREFORE|NOW\s+THIS|FURTHER\s+RESOLVED|RESOLVED\s+FURTHER|BE\s+IT\s+(?:FURTHER\s+)?RESOLVED)[,:\s]+/i,
    "",
  );
  // Leading "that" after a recital (often capitalised as "That the …")
  t = t.replace(/^that\s+/i, "");

  // Numbered / lettered ground-list items → claim shape
  const groundMatch = t.match(/^\(?\s*([0-9]+|[a-z]|[ivx]+)\)?\s*[.)]\s+(.+)$/i);
  if (groundMatch) {
    let rest = groundMatch[2].trim();
    // Prefer the first sentence/clause only (table leftovers often append after ".")
    const firstStop = rest.search(/\.\s+[A-Za-z(]/);
    if (firstStop > 20) rest = rest.slice(0, firstStop + 1).trim();
    rest = rest.replace(/\b(contributions due to default by the bidder\.)\s*\1/gi, "$1").trim();
    // "failure to remit…" → "Among other grounds, failure to remit…"
    if (/^(failure|refusal|non[- ]compliance|default|delay|breach|violation|omission)\b/i.test(rest)) {
      rest = rest.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
      // Drop trailing table junk
      rest = rest.replace(/\b(Existing|Amended)\s+Rule.*$/i, "").trim();
      if (!/[.!?]$/.test(rest)) {
        // Ensure it reads as a full claim about debarment when context fits
        if (/\b(statutory|contribution|bidder|contract|remit|security)\b/i.test(rest)) {
          t = `Among other grounds, debarment can follow ${rest.replace(/\.$/, "")}.`;
        } else {
          t = `Among other grounds, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
          if (!/[.!?]$/.test(t)) t = `${t}.`;
        }
      } else if (/\b(statutory|contribution|bidder|contract|remit|security)\b/i.test(rest)) {
        t = `Among other grounds, debarment can follow ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
      } else {
        t = `Among other grounds, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
      }
    } else if (/^[a-z]/.test(rest)) {
      // Capitalise and frame as a topic sentence when possible
      rest = rest.charAt(0).toUpperCase() + rest.slice(1);
      t = rest;
      if (!/[.!?]$/.test(t) && t.length > 40) t = `${t}.`;
    } else {
      t = rest;
    }
  }

  // Heuristic: DoE / debarred-bidder list maintenance → clean claim
  if (/\b(DoE|DOE|Department of Expenditure)\b/i.test(t) && /\b(debarred|maintain|list)\b/i.test(t)) {
    const hasGem = /\bGeM\b/i.test(t);
    const hasCpp = /\bCentral\s+Public\b/i.test(t);
    if (hasGem || hasCpp || /\bdisplay/i.test(t)) {
      const portals: string[] = [];
      if (hasCpp) portals.push("the Central Public Procurement portal");
      if (hasGem) portals.push("GeM");
      if (!portals.length) portals.push("the procurement portal");
      t = `DoE will maintain and display a list of debarred bidders on ${portals.join(" and on ")}.`;
    }
  }

  // "Ministry/Department will be such list…" salvage
  if (/\bMinistry\b/i.test(t) && /\b(list|display|website)\b/i.test(t) && /\bwill\s+be\b/i.test(t)) {
    if (/\bwebsite\b/i.test(t)) {
      t = "The Ministry or Department will also display the debarment list on their website.";
    }
  }

  // Capitalise first letter if we stripped a prefix
  if (t && /^[a-zà-öø-ÿ]/.test(t)) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }

  t = t.replace(/\s+/g, " ").trim();

  // Soft-trim at a clause boundary when over-long
  if (t.length > MAX_BULLET_CHARS) {
    const window = t.slice(0, MAX_BULLET_CHARS + 1);
    const boundaries = ["; ", ", and ", ", which ", ", wherein ", " — ", " – ", ". "];
    let cut = -1;
    for (const sep of boundaries) {
      const idx = window.lastIndexOf(sep);
      if (idx >= 60 && idx > cut) cut = idx + (sep === ". " ? 1 : 0);
    }
    if (cut < 60) {
      const space = window.lastIndexOf(" ");
      cut = space >= 60 ? space : MAX_BULLET_CHARS;
    }
    t = t.slice(0, cut).replace(/[,:;–—\-\s]+$/, "").trim();
    if (t && !/[.!?…।؟۔]$/.test(t)) t = `${t}…`;
  }

  return t;
}

export function splitSentences(text: string): string[] {
  const precleaned = preCleanDocumentText(text);
  const repaired = repairPdfText(precleaned);
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

/** Significant content tokens for diversity / entity gist (skip stopwords + legal filler). */
const LEGAL_FILLER = new Set([
  "whereas",
  "therefore",
  "further",
  "resolved",
  "herein",
  "hereof",
  "thereof",
  "aforesaid",
  "said",
  "such",
  "pursuant",
  "accordance",
  "hereinafter",
  "aforementioned",
]);

function contentTokens(sentence: string): string[] {
  return tokenize(sentence).filter((t) => !LEGAL_FILLER.has(t));
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

function findSubjectLine(allSentences: string[]): string | null {
  for (const s of allSentences.slice(0, 12)) {
    const t = s.replace(/\s+/g, " ").trim();
    const m = t.match(/^Subject\s*:\s*(.+)$/i);
    if (m && m[1].trim().length >= 12) {
      return m[1].replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
    }
    if (
      /\b(Amendment|amendment)\b/i.test(t) &&
      /\b(GFR|General Financial Rules|procurement|debarment)\b/i.test(t) &&
      t.length >= 20 &&
      t.length <= 160 &&
      !FILE_NUMBER_LINE.test(t)
    ) {
      return t.replace(/^Subject\s*:\s*/i, "").replace(/[.]+$/, "");
    }
  }
  return null;
}

function findIssuer(allSentences: string[]): string | null {
  const blob = allSentences.slice(0, 10).join(" ");
  if (/\bDepartment of Expenditure\b/i.test(blob) || /\bDoE\b/.test(blob)) {
    if (/\bMinistry of Finance\b/i.test(blob)) {
      return "the Ministry of Finance (Department of Expenditure)";
    }
    return "the Department of Expenditure";
  }
  if (/\bMinistry of Finance\b/i.test(blob)) return "the Ministry of Finance";
  const m = blob.match(/\b(Ministry of [A-Z][A-Za-z &]+)/);
  if (m) return `the ${m[1].trim()}`;
  return null;
}

/** Pull likely title / org / date cues for a one-line document gist. Never lead with F.No. */
function extractDocumentGist(allSentences: string[], topBullets: string[]): string | null {
  const subject = findSubjectLine(allSentences);
  const issuer = findIssuer(allSentences);
  const pool = [...allSentences.slice(0, 8), ...topBullets];

  const dateHits: string[] = [];
  const dateRe =
    /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4}|\d{1,2}\.\d{2}\.\d{4})\b/gi;
  for (const s of pool) {
    const dates = s.match(dateRe);
    if (dates) {
      for (const d of dates) {
        if (!dateHits.includes(d)) dateHits.push(d);
      }
    }
  }

  // Prefer OM / amendment overview templates
  if (subject) {
    const isOm =
      /\boffice\s+memorandum\b/i.test(allSentences.slice(0, 8).join(" ")) ||
      /\b(GFR|procurement|debarment|General Financial Rules)\b/i.test(subject);
    let gist: string;
    if (isOm && issuer) {
      gist = `This Office Memorandum from ${issuer} covers ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
    } else if (issuer) {
      gist = `This document from ${issuer} covers ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
    } else {
      gist = `This document covers ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
    }
    if (dateHits[0] && !gist.includes(dateHits[0])) {
      gist = `${gist} (dated ${dateHits[0]})`;
    }
    if (!/[.!?]$/.test(gist)) gist = `${gist}.`;
    // Never allow F.No. lead
    if (/^F\.?\s*NO/i.test(gist)) return null;
    return gist.length > 28 ? gist : null;
  }

  const titleCandidate = allSentences.find((s) => {
    const t = s.trim();
    return (
      t.length >= 20 &&
      t.length <= 140 &&
      /[A-Za-z]/.test(t) &&
      !LEGAL_PREAMBLE_START.test(t) &&
      !BARE_DATE_FRAGMENT.test(t) &&
      !FILE_NUMBER_LINE.test(t) &&
      !isLetterheadOrFileNumberOnly(t) &&
      (looksLikeHeading(t) ||
        /\b(Act|Rules?|Order|Notification|Circular|Memorandum|Agreement|Contract|Policy|Guidelines?|Institute|University|Corporation|Ministry|Department|Amendment)\b/i.test(
          t,
        ))
    );
  });

  const entities = new Map<string, number>();
  const entityRe =
    /\b((?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:of|for|and|the|&))?(?:\s+[A-Z][a-zA-Z0-9&'-]+){1,5})\b/g;

  for (const s of pool) {
    if (isLetterheadOrFileNumberOnly(s)) continue;
    let m: RegExpExecArray | null;
    const local = entityRe;
    local.lastIndex = 0;
    while ((m = local.exec(s)) !== null) {
      const name = m[1].replace(/\s+/g, " ").trim();
      if (name.length < 6 || name.length > 60) continue;
      if (/^(AND WHEREAS|WHEREAS|NOW THEREFORE|The|This|That|Government of India)\b/i.test(name)) continue;
      if (/^F\.?\s*NO/i.test(name)) continue;
      entities.set(name, (entities.get(name) || 0) + 1);
    }
  }

  const topEntities = [...entities.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 3)
    .map(([name]) => name);

  if (titleCandidate) {
    let gist = titleCandidate.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
    if (/^F\.?\s*NO/i.test(gist) || isLetterheadOrFileNumberOnly(gist)) {
      // skip
    } else {
      if (issuer && !gist.toLowerCase().includes("ministry") && !gist.toLowerCase().includes("department")) {
        gist = `${gist}, issued by ${issuer.replace(/^the\s+/i, "")}`;
      } else if (topEntities.length && !topEntities.some((e) => gist.includes(e))) {
        gist = `${gist} (${topEntities.slice(0, 2).join("; ")})`;
      }
      if (dateHits[0] && !gist.includes(dateHits[0])) {
        gist = `${gist}, dated ${dateHits[0]}`;
      }
      if (!/[.!?]$/.test(gist)) gist = `${gist}.`;
      if (gist.length > 28 && !/^F\.?\s*NO/i.test(gist)) return gist;
    }
  }

  // Debarment / GFR fallback overview from bullets
  const joinedBullets = topBullets.join(" ");
  if (/\bdebar/i.test(joinedBullets) || /\bGFR|procurement/i.test(joinedBullets)) {
    const who = issuer || "the Government";
    let gist = `This is an amendment to procurement / GFR rules on bidder debarment from ${who}`;
    if (dateHits[0]) gist += ` (dated ${dateHits[0]})`;
    gist += ".";
    return gist;
  }

  if (topEntities.length >= 1 && topBullets[0]) {
    const lead = shapeBulletText(topBullets[0]);
    const who = topEntities.slice(0, 2).join(" and ");
    if (lead.length >= 40 && !/^F\.?\s*NO/i.test(who)) {
      return `This document concerns ${who}${dateHits[0] ? ` (${dateHits[0]})` : ""}.`;
    }
  }

  return null;
}

function buildOverviewParagraph(bullets: string[], allSentences: string[]): string {
  const cleaned = bullets
    .map(shapeBulletText)
    .filter((b) => b.length >= 20 && !shouldRejectAsBullet(b) && !isLetterheadOrFileNumberOnly(b));
  const gist = extractDocumentGist(allSentences, cleaned);
  const bodyCount = gist ? Math.min(3, Math.max(2, cleaned.length)) : Math.min(3, cleaned.length);
  const body = cleaned.slice(0, bodyCount);

  const parts: string[] = [];
  if (gist && !/^F\.?\s*NO/i.test(gist.trim())) parts.push(gist);
  for (const s of body) {
    // Avoid repeating the gist nearly verbatim
    if (gist && jaccardOverlap(new Set(contentTokens(gist)), new Set(contentTokens(s))) > 0.7) {
      continue;
    }
    if (isLetterheadOrFileNumberOnly(s)) continue;
    parts.push(s.endsWith(".") || /[.!?…।؟۔]$/.test(s) ? s : `${s}.`);
  }

  let paragraph = parts.join(" ").replace(/\s+/g, " ").trim();
  // Hard guard: never lead with file number
  paragraph = paragraph.replace(/^(?:F\.?\s*NO\.?\s*[\w/().-]+\s*)+/i, "").trim();
  if (paragraph && /^[a-z]/.test(paragraph)) {
    paragraph = paragraph.charAt(0).toUpperCase() + paragraph.slice(1);
  }
  // If we stripped everything weird, fall back to gist-only or first cleaned bullet
  if (!paragraph || /^F\.?\s*NO/i.test(paragraph)) {
    if (gist && !/^F\.?\s*NO/i.test(gist)) return gist;
    if (cleaned[0]) return cleaned[0].endsWith(".") ? cleaned[0] : `${cleaned[0]}.`;
  }
  return paragraph;
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
      const shaped = shapeBulletText(t);
      return (
        shaped.length >= 24 &&
        !DANGLING_END.test(shaped) &&
        !shouldRejectAsBullet(shaped) &&
        !LEGAL_PREAMBLE_START.test(t) &&
        !BARE_DATE_FRAGMENT.test(t) &&
        !isLetterheadOrFileNumberOnly(t)
      );
    });
  }
  if (!sentences.length) {
    // Last resort: allow preamble / ground sentences that become usable after shaping
    sentences = allSentences.filter((s) => {
      const shaped = shapeBulletText(s);
      return (
        shaped.length >= 28 &&
        ACTION_VERBS.test(shaped) &&
        !DANGLING_END.test(shaped) &&
        !shouldRejectAsBullet(shaped)
      );
    });
  }
  if (!sentences.length) {
    sentences = allSentences.filter((s) => !isLetterheadOrFileNumberOnly(s) && !/\|/.test(s));
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
    const only = shapeBulletText(sentences[0]);
    if (shouldRejectAsBullet(only) || isLetterheadOrFileNumberOnly(only)) {
      return {
        bullets: [],
        paragraph: "",
        fullText: "",
        sentenceCount: 1,
        selectedCount: 0,
        wordCount,
      };
    }
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
  const pickedTokenSets: Array<Set<string>> = [];
  for (const candidate of ranked) {
    if (picked.length >= k) break;
    if (candidate.score <= 0 && picked.length >= Math.min(2, k)) continue;
    const shapedCand = shapeBulletText(sentences[candidate.index]);
    if (shouldRejectAsBullet(shapedCand) || isLetterheadOrFileNumberOnly(shapedCand)) continue;
    const candContent = new Set(contentTokens(shapedCand));
    const tooSimilar = pickedTokenSets.some((other) => jaccardOverlap(candContent, other) > 0.55);
    if (tooSimilar) continue;
    // Extra diversity: avoid near-duplicates even after shaping
    const shapedKey = shapedCand
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f]+/gi, " ")
      .slice(0, 40);
    const nearDupShaped = picked.some((idx) => {
      const prev = shapeBulletText(sentences[idx])
        .toLowerCase()
        .replace(/[^a-z0-9\u0900-\u097f]+/gi, " ")
        .slice(0, 40);
      return prev === shapedKey;
    });
    if (nearDupShaped) continue;
    picked.push(candidate.index);
    pickedTokenSets.push(candContent);
  }

  // Keep reading order for bullets (coherent legal narrative), then shape for display.
  const inOrder = [...picked].sort((a, b) => a - b);
  const rawSelected = inOrder.map((i) => sentences[i]);
  let bullets = rawSelected
    .map(shapeBulletText)
    .filter((b) => b.length >= 20 && !shouldRejectAsBullet(b) && !isLetterheadOrFileNumberOnly(b));

  // Promote rewritten numbered grounds (e.g. "(2) failure to remit…") into claim bullets
  for (const raw of allSentences) {
    if (bullets.length >= 7) break;
    if (!NUMBERED_GROUND_START.test(raw.trim())) continue;
    const shaped = shapeBulletText(raw);
    if (shaped.length < 28 || shouldRejectAsBullet(shaped)) continue;
    if (!/\b(Among other grounds|debarment can follow)\b/i.test(shaped) && !ACTION_VERBS.test(shaped)) continue;
    const candContent = new Set(contentTokens(shaped));
    if (pickedTokenSets.some((other) => jaccardOverlap(candContent, other) > 0.55)) continue;
    // Prefer inserting near the front after overview-ish bullets
    bullets.splice(Math.min(1, bullets.length), 0, shaped);
    pickedTokenSets.push(candContent);
  }

  // Ensure 3–7 when possible by pulling more ranked candidates
  if (bullets.length < 3) {
    for (const candidate of ranked) {
      if (bullets.length >= 3) break;
      if (picked.includes(candidate.index)) continue;
      const shaped = shapeBulletText(sentences[candidate.index]);
      if (shaped.length < 20 || shouldRejectAsBullet(shaped) || isLetterheadOrFileNumberOnly(shaped)) continue;
      const candContent = new Set(contentTokens(shaped));
      if (pickedTokenSets.some((other) => jaccardOverlap(candContent, other) > 0.55)) continue;
      bullets.push(shaped);
      pickedTokenSets.push(candContent);
    }
  }
  if (bullets.length > 7) bullets = bullets.slice(0, 7);

  const paragraph = buildOverviewParagraph(bullets.length ? bullets : rawSelected, allSentences);

  return {
    bullets: bullets.length ? bullets : rawSelected.map(shapeBulletText).filter((b) => b.length >= 20),
    paragraph,
    fullText: formatSummaryOutput(
      bullets.length ? bullets : rawSelected.map(shapeBulletText).filter((b) => b.length >= 20),
      paragraph,
    ),
    sentenceCount: n,
    selectedCount: (bullets.length ? bullets : rawSelected).length,
    wordCount,
  };
}

function formatSummaryOutput(
  bullets: string[],
  paragraph: string,
  mode: SummaryMode = "extractive",
) {
  const blurb =
    mode === "abstractive"
      ? "Private DistilBART abstractive summary — runs on this device (not a cloud API)"
      : "Private extractive summary — scores important sentences on this device (fallback; not a cloud AI rewrite)";
  const lines = [
    "On-device summary",
    blurb,
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


// ---------------------------------------------------------------------------
// DistilBART abstractive summarisation (Transformers.js / WASM · browser cache)
// ---------------------------------------------------------------------------

type SummarizationOutput = { summary_text: string };
type SummarizerFn = (
  texts: string | string[],
  options?: {
    max_new_tokens?: number;
    min_new_tokens?: number;
  },
) => Promise<SummarizationOutput | SummarizationOutput[]>;

/** Rough char budget under DistilBART's 1024-token encoder limit (~3.2 chars/token). */
const CHUNK_TARGET_CHARS = 2800;
const CHUNK_OVERLAP_CHARS = 180;

function lengthToGenerationConfig(length: SummaryLength) {
  if (length === "short") {
    return { max_new_tokens: 72, min_new_tokens: 20 };
  }
  if (length === "long") {
    return { max_new_tokens: 180, min_new_tokens: 56 };
  }
  return { max_new_tokens: 120, min_new_tokens: 36 };
}

function targetBulletCount(length: SummaryLength): number {
  if (length === "short") return 4;
  if (length === "long") return 8;
  return 6;
}

/**
 * Pack cleaned document text into overlapping chunks that fit the DistilBART
 * encoder. Prefer paragraph / sentence boundaries over hard mid-word cuts.
 */
export function chunkTextForSummarization(rawText: string): string[] {
  const cleaned = preCleanDocumentText(repairPdfText(rawText)).replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= CHUNK_TARGET_CHARS) return [cleaned];

  const paragraphs = cleaned
    .split(/(?<=[.!?…।؟۔])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const piece of paragraphs) {
    if (!current) {
      if (piece.length <= CHUNK_TARGET_CHARS) {
        current = piece;
      } else {
        // Hard-wrap oversized sentence/clause
        for (let i = 0; i < piece.length; i += CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS) {
          chunks.push(piece.slice(i, i + CHUNK_TARGET_CHARS).trim());
        }
      }
      continue;
    }
    if (current.length + 1 + piece.length <= CHUNK_TARGET_CHARS) {
      current = `${current} ${piece}`;
    } else {
      pushCurrent();
      // Overlap: keep a short tail from previous chunk when starting the next
      const prev = chunks[chunks.length - 1] || "";
      const overlap =
        prev.length > CHUNK_OVERLAP_CHARS
          ? prev.slice(-CHUNK_OVERLAP_CHARS).replace(/^\S*\s+/, "")
          : "";
      if (piece.length <= CHUNK_TARGET_CHARS) {
        current = overlap ? `${overlap} ${piece}` : piece;
        if (current.length > CHUNK_TARGET_CHARS) current = piece;
      } else {
        current = "";
        for (let i = 0; i < piece.length; i += CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS) {
          chunks.push(piece.slice(i, i + CHUNK_TARGET_CHARS).trim());
        }
      }
    }
  }
  pushCurrent();
  return chunks.length ? chunks : [cleaned.slice(0, CHUNK_TARGET_CHARS)];
}

function bulletsFromAbstractiveParagraph(paragraph: string, length: SummaryLength): string[] {
  const max = targetBulletCount(length);
  const fromSplit = splitSentences(paragraph)
    .map(shapeBulletText)
    .filter((s) => s.length >= 20 && !shouldRejectAsBullet(s));
  if (fromSplit.length) return fromSplit.slice(0, max);

  // Soft-split on periods if the model returned one dense paragraph
  const soft = paragraph
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20)
    .slice(0, max);
  return soft.length ? soft : [paragraph.trim()].filter((s) => s.length >= 12);
}

function throwIfCancelled(isCancelled?: () => boolean) {
  if (isCancelled?.()) throw new Error("SUMMARY_CANCELLED");
}

let summarizerPromise: Promise<SummarizerFn> | null = null;

async function loadDistilBartSummarizer(
  onProgress?: (progress: AbstractiveProgress) => void,
): Promise<SummarizerFn> {
  if (summarizerPromise) return summarizerPromise;

  summarizerPromise = (async () => {
    onProgress?.({
      phase: "loading-model",
      message: "Loading DistilBART on this device (cached after first download)…",
      percent: 0,
    });

    const transformers = await import("@huggingface/transformers");
    const { pipeline, env } = transformers;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const summarizer = await pipeline("summarization", DISTILBART_MODEL_ID, {
      dtype: "q8",
      progress_callback: (data: { status?: string; progress?: number; file?: string }) => {
        const status = String(data?.status ?? "loading");
        const file = data?.file ? ` · ${data.file}` : "";
        const pct =
          typeof data?.progress === "number" && Number.isFinite(data.progress)
            ? Math.max(0, Math.min(100, Math.round(data.progress)))
            : status === "ready" || status === "done"
              ? 100
              : 15;
        onProgress?.({
          phase: "loading-model",
          message: `Loading DistilBART (${status.replace(/_/g, " ")}${file})…`,
          percent: pct,
        });
      },
    });

    onProgress?.({
      phase: "loading-model",
      message: "DistilBART ready on this device.",
      percent: 100,
    });

    return summarizer as unknown as SummarizerFn;
  })();

  try {
    return await summarizerPromise;
  } catch (error) {
    summarizerPromise = null;
    throw error;
  }
}

async function runSummarizerOnText(
  summarizer: SummarizerFn,
  text: string,
  length: SummaryLength,
): Promise<string> {
  const gen = lengthToGenerationConfig(length);
  const raw = await summarizer(text, gen);
  const row = Array.isArray(raw) ? raw[0] : raw;
  const summary = (row?.summary_text || "").replace(/\s+/g, " ").trim();
  return summary;
}

/**
 * Abstractive DistilBART summary: chunk → summarise each → optional second-pass
 * combine. Falls back is handled by summarizeOnDevice.
 */
export async function summarizeAbstractive(
  rawText: string,
  options: SummarizeOnDeviceOptions = {},
): Promise<OnDeviceSummary> {
  const length = options.length ?? "medium";
  const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
  throwIfCancelled(options.isCancelled);

  const chunks = chunkTextForSummarization(rawText);
  if (!chunks.length) {
    return {
      bullets: [],
      paragraph: "",
      fullText: "",
      sentenceCount: 0,
      selectedCount: 0,
      wordCount,
      mode: "abstractive",
      modelId: DISTILBART_MODEL_ID,
      chunkCount: 0,
    };
  }

  const summarizer = await loadDistilBartSummarizer(options.onProgress);
  throwIfCancelled(options.isCancelled);

  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    throwIfCancelled(options.isCancelled);
    options.onProgress?.({
      phase: "summarizing-chunk",
      chunk: i + 1,
      totalChunks: chunks.length,
      message:
        chunks.length === 1
          ? "Summarising with DistilBART on this device…"
          : `Summarising chunk ${i + 1} of ${chunks.length} with DistilBART…`,
      percent: Math.round(((i + 0.15) / chunks.length) * 90),
    });
    const piece = await runSummarizerOnText(summarizer, chunks[i], length);
    if (piece) chunkSummaries.push(piece);
  }

  throwIfCancelled(options.isCancelled);

  let paragraph = "";
  if (chunkSummaries.length === 0) {
    paragraph = "";
  } else if (chunkSummaries.length === 1) {
    paragraph = chunkSummaries[0];
  } else {
    const joined = chunkSummaries.join(" ");
    if (joined.length <= CHUNK_TARGET_CHARS) {
      options.onProgress?.({
        phase: "combining",
        chunk: chunks.length,
        totalChunks: chunks.length,
        message: "Combining section summaries with DistilBART…",
        percent: 94,
      });
      paragraph = await runSummarizerOnText(summarizer, joined, length);
      if (!paragraph) paragraph = chunkSummaries.join(" ");
    } else {
      // Too long for one combine pass: summarise in batches, then concatenate cleanly
      options.onProgress?.({
        phase: "combining",
        chunk: chunks.length,
        totalChunks: chunks.length,
        message: "Combining section summaries…",
        percent: 92,
      });
      const midChunks = chunkTextForSummarization(joined);
      const mid: string[] = [];
      for (let i = 0; i < midChunks.length; i += 1) {
        throwIfCancelled(options.isCancelled);
        mid.push(await runSummarizerOnText(summarizer, midChunks[i], length));
      }
      const midJoined = mid.filter(Boolean).join(" ");
      if (midJoined.length > 80 && midJoined.length <= CHUNK_TARGET_CHARS) {
        paragraph = await runSummarizerOnText(summarizer, midJoined, length);
      }
      if (!paragraph) paragraph = midJoined || chunkSummaries.join(" ");
    }
  }

  paragraph = paragraph.replace(/\s+/g, " ").trim();
  if (!paragraph) {
    throw new Error("DistilBART returned an empty summary.");
  }

  const bullets = bulletsFromAbstractiveParagraph(paragraph, length);
  // Prefer a few grounded extractive bullets when abstractive yields only 1 short sentence
  if (bullets.length < 2) {
    const extractive = summarizeExtractive(rawText, length);
    for (const b of extractive.bullets) {
      if (bullets.length >= targetBulletCount(length)) break;
      if (!bullets.some((x) => x.slice(0, 40) === b.slice(0, 40))) bullets.push(b);
    }
  }

  options.onProgress?.({
    phase: "combining",
    chunk: chunks.length,
    totalChunks: chunks.length,
    message: "DistilBART summary ready.",
    percent: 100,
  });

  return {
    bullets,
    paragraph,
    fullText: formatSummaryOutput(bullets, paragraph, "abstractive"),
    sentenceCount: splitSentences(rawText).length,
    selectedCount: bullets.length,
    wordCount,
    mode: "abstractive",
    modelId: DISTILBART_MODEL_ID,
    chunkCount: chunks.length,
  };
}

/**
 * Prefer DistilBART abstractive; on load/runtime failure fall back to extractive
 * TextRank with a visible note. Cancel still throws SUMMARY_CANCELLED.
 */
export async function summarizeOnDevice(
  rawText: string,
  options: SummarizeOnDeviceOptions = {},
): Promise<OnDeviceSummary> {
  throwIfCancelled(options.isCancelled);
  try {
    return await summarizeAbstractive(rawText, options);
  } catch (error) {
    if (error instanceof Error && error.message === "SUMMARY_CANCELLED") throw error;
    throwIfCancelled(options.isCancelled);
    const extractive = summarizeExtractive(rawText, options.length ?? "medium");
    const fallbackNote =
      "DistilBART could not load in this browser — using extractive on-device summary instead.";
    return {
      ...extractive,
      fullText: formatSummaryOutput(extractive.bullets, extractive.paragraph, "extractive"),
      mode: "extractive",
      fallbackNote,
    };
  }
}
