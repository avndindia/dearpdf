/**
 * Lightweight on-device document quad detector (no OpenCV CDN).
 * Combines paper-region segmentation + Sobel contours. Returns ordered
 * corners in source image coordinates: TL, TR, BR, BL.
 * Low-confidence results are soft guides so the UI can offer adjustable corners
 * instead of a wrong crop.
 */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type DetectResult = {
  corners: Quad;
  /** 0–1 rough confidence from area + rectangularity + edge support */
  confidence: number;
  /** Working canvas size used for detection */
  workWidth: number;
  workHeight: number;
};

/** Working long-side; taller than before so tall/narrow phone scans keep detail. */
const WORK_MAX = 480;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderCorners(pts: Point[]): Quad {
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function polygonArea(pts: Point[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function boxBlurGray(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const r = Math.max(1, radius);
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x += 1) {
      tmp[y * w + x] = sum / (r * 2 + 1);
      sum += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / (r * 2 + 1);
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

function sobelMagnitude(gray: Float32Array, w: number, h: number) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] +
        -2 * gray[i - 1] +
        2 * gray[i + 1] +
        -gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function dilateBinary(bin: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (bin[(y + dy) * w + (x + dx)]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erodeBinary(bin: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!bin[(y + dy) * w + (x + dx)]) {
            on = 0;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function closeBinary(bin: Uint8Array, w: number, h: number, rounds = 2) {
  let cur = bin;
  for (let i = 0; i < rounds; i += 1) cur = dilateBinary(cur, w, h);
  for (let i = 0; i < rounds; i += 1) cur = erodeBinary(cur, w, h);
  return cur;
}

/** Trace external contour of a filled component starting at seed (edge-following). */
function traceContour(bin: Uint8Array, w: number, h: number, sx: number, sy: number, visited: Uint8Array) {
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const points: Point[] = [];
  let x = sx;
  let y = sy;
  let dir = 0;
  const startKey = sy * w + sx;
  let guard = 0;
  const maxSteps = w * h;

  do {
    points.push({ x, y });
    visited[y * w + x] = 1;
    let found = false;
    for (let k = 0; k < 8; k += 1) {
      const nd = (dir + 6 + k) % 8;
      const nx = x + dx[nd];
      const ny = y + dy[nd];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (bin[ny * w + nx]) {
        x = nx;
        y = ny;
        dir = nd;
        found = true;
        break;
      }
    }
    if (!found) break;
    guard += 1;
  } while ((y * w + x) !== startKey && guard < maxSteps);

  return points.length >= 8 ? points : null;
}

function floodFillMark(bin: Uint8Array, w: number, h: number, sx: number, sy: number, label: Uint16Array, id: number) {
  const stack = [sx, sy];
  let count = 0;
  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  let borderTouch = 0;
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const i = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (!bin[i] || label[i]) continue;
    label[i] = id;
    count += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) borderTouch += 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return { count, minX, maxX, minY, maxY, borderTouch };
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  const a = points[0];
  const b = points[end];
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLen = Math.hypot(abx, aby) || 1;
  for (let i = 1; i < end; i += 1) {
    const p = points[i];
    const d = Math.abs(abx * (a.y - p.y) - (a.x - p.x) * aby) / abLen;
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function extremeQuad(sampled: Point[]): Quad {
  let tl = sampled[0];
  let tr = sampled[0];
  let br = sampled[0];
  let bl = sampled[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  for (const p of sampled) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
  }
  return [tl, tr, br, bl];
}

function sampleAlongEdge(mag: Float32Array, w: number, h: number, a: Point, b: Point, samples = 24) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = clamp(Math.round(a.x + (b.x - a.x) * t), 1, w - 2);
    const y = clamp(Math.round(a.y + (b.y - a.y) * t), 1, h - 2);
    sum += mag[y * w + x];
    n += 1;
  }
  return n ? sum / n : 0;
}

function scoreQuad(
  corners: Quad,
  w: number,
  h: number,
  mag: Float32Array | null,
  opts?: { preferLarge?: boolean; filledFrac?: number },
): number | null {
  const area = polygonArea(corners);
  const frameArea = w * h;
  const areaRatio = area / frameArea;
  // Reject tiny text-column quads and near-full-frame noise.
  if (areaRatio < 0.12 || areaRatio > 0.96) return null;

  const [tl, tr, br, bl] = corners;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 10 || bottom < 10 || left < 10 || right < 10) return null;

  const widthRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const heightRatio = Math.min(left, right) / Math.max(left, right);
  // Allow tall/narrow pages and mild perspective; reject wild bowties.
  if (widthRatio < 0.28 || heightRatio < 0.28) return null;

  const aspect = Math.max(top, bottom) / Math.max(left, right);
  // Reject text-column / strip false positives (bad warps looked like ~900×2400).
  if (aspect > 2.35 || aspect < 0.42) return null;

  // Convexity / non-crossing check via cross products of consecutive edges.
  const pts = [tl, tr, br, bl];
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign && s !== sign) return null;
      sign = s;
    }
  }

  let edgeSupport = 0.55;
  if (mag) {
    const edges = [
      sampleAlongEdge(mag, w, h, tl, tr),
      sampleAlongEdge(mag, w, h, tr, br),
      sampleAlongEdge(mag, w, h, br, bl),
      sampleAlongEdge(mag, w, h, bl, tl),
    ];
    const meanEdge = edges.reduce((a, b) => a + b, 0) / 4;
    // Normalize loosely vs typical Sobel magnitudes after blur.
    edgeSupport = clamp(meanEdge / 45, 0, 1);
  }

  const filled = opts?.filledFrac ?? areaRatio;
  const sizeBias = opts?.preferLarge ? clamp((areaRatio - 0.18) / 0.55, 0, 1) : areaRatio;
  const rect = (widthRatio + heightRatio) / 2;

  // Soft penalty when filled mask is much larger than the quad (under-crop)
  // or much smaller (text island).
  const fillFit = 1 - clamp(Math.abs(filled - areaRatio) / 0.35, 0, 1);

  // Prefer page-like proportions (portrait ~0.7, landscape ~1.4).
  const pageLike = 1 - clamp(
    Math.min(Math.abs(Math.log(aspect / 0.72)), Math.abs(Math.log(aspect / 1.35))) / 1.1,
    0,
    1,
  );

  const score =
    sizeBias * 0.34 +
    rect * 0.18 +
    edgeSupport * 0.26 +
    fillFit * 0.10 +
    pageLike * 0.12;
  return score;
}

/** True when a quad is safe to auto-crop (not a thin strip / bowtie). */
export function isSaneDocumentQuad(corners: Quad, frameW: number, frameH: number): boolean {
  const area = polygonArea(corners);
  const frameArea = Math.max(1, frameW * frameH);
  const areaRatio = area / frameArea;
  if (areaRatio < 0.12 || areaRatio > 0.97) return false;
  const [tl, tr, br, bl] = corners;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return false;
  const widthRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const heightRatio = Math.min(left, right) / Math.max(left, right);
  // Strong perspective is OK; collapsed sides (text-column / bad contour) are not.
  if (widthRatio < 0.55 || heightRatio < 0.55) return false;
  const aspect = Math.max(top, bottom) / Math.max(left, right);
  if (aspect > 2.5 || aspect < 0.4) return false;
  // Reject when a corner sits far inside the AABB (diagonal slash through page).
  const minX = Math.min(tl.x, tr.x, br.x, bl.x);
  const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
  const minY = Math.min(tl.y, tr.y, br.y, bl.y);
  const maxY = Math.max(tl.y, tr.y, br.y, bl.y);
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  for (const p of [tl, tr, br, bl]) {
    const insetX = Math.min(p.x - minX, maxX - p.x) / bw;
    const insetY = Math.min(p.y - minY, maxY - p.y) / bh;
    if (insetX > 0.22 && insetY > 0.22) return false;
  }
  return true;
}

function bestQuadFromContour(
  contour: Point[],
  w: number,
  h: number,
  mag: Float32Array | null,
  filledFrac?: number,
): { corners: Quad; score: number } | null {
  if (contour.length < 20) return null;
  const step = Math.max(1, Math.floor(contour.length / 160));
  const sampled: Point[] = [];
  for (let i = 0; i < contour.length; i += step) sampled.push(contour[i]);
  if (sampled.length < 4) return null;

  const baseEps = Math.max(2.5, Math.min(w, h) * 0.018);
  const attempts = [1, 1.6, 0.65, 2.2, 0.45];
  let best: { corners: Quad; score: number } | null = null;

  for (const mul of attempts) {
    const approx = douglasPeucker([...sampled, sampled[0]], baseEps * mul).slice(0, -1);
    let corners: Quad;
    if (approx.length === 4) {
      corners = orderCorners(approx);
    } else if (approx.length > 4 && approx.length <= 8) {
      // Collapse to extremes when DP over-segments (curved book edges).
      corners = extremeQuad(approx);
    } else {
      corners = extremeQuad(sampled);
    }
    const score = scoreQuad(corners, w, h, mag, { preferLarge: true, filledFrac });
    if (score != null && (!best || score > best.score)) best = { corners, score };
  }

  return best;
}

function defaultGuideQuad(w: number, h: number): Quad {
  // Slightly tighter inset so failed edge-detect still crops desk margins.
  const ix = w * 0.08;
  const iy = h * 0.09;
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ];
}

function readWorkImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): { w: number; h: number; scale: number; data: Uint8ClampedArray } | null {
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, WORK_MAX / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(32, Math.round(sourceWidth * scale));
  const h = Math.max(32, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { w, h, scale, data };
}

function lumaAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
}

function chromaAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
}

/**
 * Build a paper-like mask: bright, low-chroma pixels that differ from the
 * border/desk estimate. Works for dark desks and busy newspaper backgrounds.
 */
function buildPaperMask(data: Uint8ClampedArray, w: number, h: number): {
  mask: Uint8Array;
  gray: Float32Array;
  mag: Float32Array;
} {
  const gray = new Float32Array(w * h);
  const chroma = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      gray[i] = lumaAt(data, w, x, y);
      chroma[i] = chromaAt(data, w, x, y);
    }
  }

  const borderBand = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const borderLuma: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x < borderBand || y < borderBand || x >= w - borderBand || y >= h - borderBand) {
        borderLuma.push(gray[y * w + x]);
      }
    }
  }
  borderLuma.sort((a, b) => a - b);
  const deskLow = percentile(borderLuma, 0.25);
  const deskMid = percentile(borderLuma, 0.5);
  const deskHigh = percentile(borderLuma, 0.75);

  // Global paper hint: upper luminance of the whole frame.
  const allLuma = Array.from(gray).sort((a, b) => a - b);
  const paperHint = percentile(allLuma, 0.78);

  // Adaptive cut: paper should be brighter than typical desk, but on newspaper
  // the border itself is bright — then require near-white + low chroma.
  const deskSpread = deskHigh - deskLow;
  const busyBorder = deskMid > 110 && deskSpread > 35;
  const brightCut = busyBorder
    ? Math.max(paperHint - 2, Math.min(220, Math.max(deskHigh + 12, 185)))
    : Math.min(205, Math.max(deskMid + 22, deskLow + 35));

  // Local 3×3 variance — newspaper text is high-variance; blank paper margins less so.
  // Document body has text too, so we only use this as a soft prior near borders.
  const var3 = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let s = 0;
      let s2 = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const v = gray[(y + dy) * w + (x + dx)];
          s += v;
          s2 += v * v;
        }
      }
      const mean = s / 9;
      var3[y * w + x] = Math.max(0, s2 / 9 - mean * mean);
    }
  }

  let mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i += 1) {
    const L = gray[i];
    const C = chroma[i];
    const x = i % w;
    const y = (i / w) | 0;
    const nearBorder =
      x < w * 0.08 || y < h * 0.08 || x > w * 0.92 || y > h * 0.92;
    // Paper: bright enough and not colorful ads.
    const chromaLim = busyBorder ? (nearBorder ? 36 : 46) : 55;
    const paperLike = L >= brightCut && C < chromaLim;
    // Also accept mild-gray paper vs clearly darker desk.
    const vsDesk = !busyBorder && L >= deskMid + 18 && C < 60 && L > 95;
    // On busy borders, reject high-variance colorful newspaper patches near the frame.
    const newsNoise = busyBorder && nearBorder && (var3[i] > 380 || C > 40) && L < brightCut + 15;
    mask[i] = !newsNoise && (paperLike || vsDesk) ? 1 : 0;
  }

  // Fill text holes inside the page; strip thin noise.
  mask = new Uint8Array(closeBinary(mask, w, h, busyBorder ? 2 : 2));
  mask = new Uint8Array(erodeBinary(mask, w, h));
  mask = new Uint8Array(dilateBinary(mask, w, h));

  const blurred = boxBlurGray(gray, w, h, 1);
  const mag = sobelMagnitude(blurred, w, h);
  return { mask, gray, mag };
}


/** Grow a paper AABB while neighboring pixels still look paper-like. */
function expandPaperBounds(
  mask: Uint8Array,
  gray: Float32Array,
  w: number,
  h: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const paperLuma = (() => {
    let s = 0;
    let n = 0;
    for (let y = minY; y <= maxY; y += 3) {
      for (let x = minX; x <= maxX; x += 3) {
        if (!mask[y * w + x]) continue;
        s += gray[y * w + x];
        n += 1;
      }
    }
    return n ? s / n : 180;
  })();
  const thr = paperLuma - 28;

  const tryExpand = (dir: "left" | "right" | "up" | "down") => {
    for (let step = 0; step < Math.max(w, h); step += 1) {
      let hits = 0;
      let total = 0;
      if (dir === "down") {
        const y = maxY + 1;
        if (y >= h - 1) return;
        for (let x = minX; x <= maxX; x += 2) {
          total += 1;
          if (gray[y * w + x] >= thr) hits += 1;
        }
        if (hits / Math.max(1, total) < 0.55) return;
        maxY = y;
      } else if (dir === "up") {
        const y = minY - 1;
        if (y <= 0) return;
        for (let x = minX; x <= maxX; x += 2) {
          total += 1;
          if (gray[y * w + x] >= thr) hits += 1;
        }
        if (hits / Math.max(1, total) < 0.55) return;
        minY = y;
      } else if (dir === "left") {
        const x = minX - 1;
        if (x <= 0) return;
        for (let y = minY; y <= maxY; y += 2) {
          total += 1;
          if (gray[y * w + x] >= thr) hits += 1;
        }
        if (hits / Math.max(1, total) < 0.55) return;
        minX = x;
      } else {
        const x = maxX + 1;
        if (x >= w - 1) return;
        for (let y = minY; y <= maxY; y += 2) {
          total += 1;
          if (gray[y * w + x] >= thr) hits += 1;
        }
        if (hits / Math.max(1, total) < 0.55) return;
        maxX = x;
      }
    }
  };
  tryExpand("up");
  tryExpand("down");
  tryExpand("left");
  tryExpand("right");
  return { minX, minY, maxX, maxY };
}

function quadFromLargestPaperRegion(
  mask: Uint8Array,
  gray: Float32Array,
  mag: Float32Array,
  w: number,
  h: number,
): { corners: Quad; score: number } | null {
  const label = new Uint16Array(w * h);
  let nextId = 1;
  let best: { corners: Quad; score: number } | null = null;
  const visited = new Uint8Array(w * h);
  const minArea = w * h * 0.08;

  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const i = y * w + x;
      if (!mask[i] || label[i]) continue;
      const id = nextId++;
      const region = floodFillMark(mask, w, h, x, y, label, id);
      if (region.count < minArea) continue;
      // Reject components that are mostly the frame border (full-bleed wash).
      if (region.borderTouch > region.count * 0.45 && region.count > w * h * 0.85) continue;

      const bw = region.maxX - region.minX + 1;
      const bh = region.maxY - region.minY + 1;
      if (bw < w * 0.18 || bh < h * 0.18) continue;

      // Prefer page-like regions near the frame center (desk photos).
      const rcx = (region.minX + region.maxX) / 2;
      const rcy = (region.minY + region.maxY) / 2;
      const centerDist =
        Math.hypot(rcx - (w - 1) / 2, rcy - (h - 1) / 2) / (Math.hypot(w, h) / 2);
      const centerBoost = 1 - clamp(centerDist, 0, 1) * 0.12;

      let sx = -1;
      let sy = -1;
      outer: for (let yy = region.minY; yy <= region.maxY; yy += 1) {
        for (let xx = region.minX; xx <= region.maxX; xx += 1) {
          if (label[yy * w + xx] !== id) continue;
          // Prefer a true border pixel of the component.
          const edge =
            xx === region.minX ||
            xx === region.maxX ||
            yy === region.minY ||
            yy === region.maxY ||
            !mask[yy * w + xx - 1] ||
            !mask[yy * w + xx + 1] ||
            !mask[(yy - 1) * w + xx] ||
            !mask[(yy + 1) * w + xx];
          if (edge) {
            sx = xx;
            sy = yy;
            break outer;
          }
        }
      }
      if (sx < 0) continue;

      const componentMask = new Uint8Array(w * h);
      for (let k = 0; k < label.length; k += 1) if (label[k] === id) componentMask[k] = 1;
      const contour = traceContour(componentMask, w, h, sx, sy, visited);
      if (!contour) continue;
      const filledFrac = region.count / (w * h);
      // Only grow when the page already kisses the frame (partial capture) and
      // the outward strip looks like plain desk — not busy newspaper.
      const touchesFrame =
        region.minX <= 2 ||
        region.minY <= 2 ||
        region.maxX >= w - 3 ||
        region.maxY >= h - 3;
      let expanded = {
        minX: region.minX,
        minY: region.minY,
        maxX: region.maxX,
        maxY: region.maxY,
      };
      if (touchesFrame) {
        expanded = expandPaperBounds(
          mask,
          gray,
          w,
          h,
          region.minX,
          region.minY,
          region.maxX,
          region.maxY,
        );
      }
      const eBw = expanded.maxX - expanded.minX + 1;
      const eBh = expanded.maxY - expanded.minY + 1;
      const padX = Math.max(1, Math.round(eBw * 0.01));
      const padY = Math.max(1, Math.round(eBh * 0.01));
      const aa: Quad = [
        { x: clamp(expanded.minX - padX, 0, w - 1), y: clamp(expanded.minY - padY, 0, h - 1) },
        { x: clamp(expanded.maxX + padX, 0, w - 1), y: clamp(expanded.minY - padY, 0, h - 1) },
        { x: clamp(expanded.maxX + padX, 0, w - 1), y: clamp(expanded.maxY + padY, 0, h - 1) },
        { x: clamp(expanded.minX - padX, 0, w - 1), y: clamp(expanded.maxY + padY, 0, h - 1) },
      ];
      const aaScore = scoreQuad(aa, w, h, mag, { preferLarge: true, filledFrac });
      const aaCandidate =
        aaScore != null
          ? { corners: aa, score: aaScore * 0.96 * centerBoost }
          : null;

      const quad = bestQuadFromContour(contour, w, h, mag, filledFrac);
      let contourCandidate: { corners: Quad; score: number } | null = null;
      if (quad && isSaneDocumentQuad(quad.corners, w, h)) {
        contourCandidate = { corners: quad.corners, score: quad.score * centerBoost };
      }

      // Prefer paper AABB unless a sane perspective contour clearly wins.
      const pick =
        contourCandidate && aaCandidate
          ? contourCandidate.score > aaCandidate.score * 1.06
            ? contourCandidate
            : aaCandidate
          : contourCandidate || aaCandidate;
      if (pick && (!best || pick.score > best.score)) best = pick;
    }
  }
  return best;
}

function quadFromSobelEdges(
  gray: Float32Array,
  mag: Float32Array,
  w: number,
  h: number,
): { corners: Quad; score: number } | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i] > 0) {
      sum += mag[i];
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  const thresh = Math.max(16, mean * 1.35);

  let bin = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i += 1) bin[i] = mag[i] >= thresh ? 1 : 0;
  bin = dilateBinary(bin, w, h);
  bin = dilateBinary(bin, w, h);
  bin = erodeBinary(bin, w, h);

  const label = new Uint16Array(w * h);
  let nextId = 1;
  let best: { corners: Quad; score: number } | null = null;
  const visitedContour = new Uint8Array(w * h);

  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const i = y * w + x;
      if (!bin[i] || label[i]) continue;
      const id = nextId++;
      const region = floodFillMark(bin, w, h, x, y, label, id);
      // Edge chains are thin — use a lower area floor than filled paper.
      if (region.count < w * h * 0.004) continue;

      let sx = -1;
      let sy = -1;
      outer: for (let yy = region.minY; yy <= region.maxY; yy += 1) {
        for (let xx = region.minX; xx <= region.maxX; xx += 1) {
          if (label[yy * w + xx] === id) {
            sx = xx;
            sy = yy;
            break outer;
          }
        }
      }
      if (sx < 0) continue;
      const mask = new Uint8Array(w * h);
      for (let k = 0; k < label.length; k += 1) if (label[k] === id) mask[k] = 1;
      const contour = traceContour(mask, w, h, sx, sy, visitedContour);
      if (!contour) continue;
      const quad = bestQuadFromContour(contour, w, h, mag);
      if (quad && (!best || quad.score > best.score)) best = quad;
    }
  }

  // Sobel-only hits are less trustworthy (text columns look rectangular).
  if (best) best = { corners: best.corners, score: best.score * 0.72 };
  void gray;
  return best;
}


/** Snap each side of a quad toward the strongest luma gradient nearby. */
function refineQuadToGradients(corners: Quad, gray: Float32Array, w: number, h: number): Quad {
  const search = Math.max(4, Math.round(Math.min(w, h) * 0.045));
  const refined: Point[] = corners.map((p) => ({ ...p }));

  // For each corner, sample along the two outward normals of adjacent edges
  // and pull toward stronger paper/desk transitions.
  const order = [0, 1, 2, 3];
  for (const i of order) {
    const prev = corners[(i + 3) % 4];
    const cur = corners[i];
    const next = corners[(i + 1) % 4];
    // Outward approx: away from quad centroid.
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    const ox = cur.x - cx;
    const oy = cur.y - cy;
    const olen = Math.hypot(ox, oy) || 1;
    const nx = ox / olen;
    const ny = oy / olen;

    let bestT = 0;
    let bestScore = -Infinity;
    for (let t = -search; t <= search; t += 1) {
      const x = clamp(Math.round(cur.x + nx * t), 1, w - 2);
      const y = clamp(Math.round(cur.y + ny * t), 1, h - 2);
      const i0 = y * w + x;
      // Gradient magnitude in outward direction.
      const g =
        Math.abs(gray[i0] - gray[clamp(y - Math.round(ny), 0, h - 1) * w + clamp(x - Math.round(nx), 0, w - 1)]) +
        Math.abs(gray[i0] - gray[clamp(y + Math.round(ny), 0, h - 1) * w + clamp(x + Math.round(nx), 0, w - 1)]);
      // Prefer staying near original corner; reward strong edges.
      const score = g - Math.abs(t) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    }
    // Only snap when the edge signal is meaningful.
    if (bestScore > 12) {
      refined[i] = {
        x: clamp(cur.x + nx * bestT, 0, w - 1),
        y: clamp(cur.y + ny * bestT, 0, h - 1),
      };
    }
    void prev;
    void next;
  }
  return orderCorners(refined);
}

/**
 * Fallback when masks miss: bright bbox vs darker desk (axis-aligned).
 */
export function detectBrightDocumentQuad(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): DetectResult | null {
  const work = readWorkImage(source, sourceWidth, sourceHeight);
  if (!work) return null;
  const { w, h, scale, data } = work;
  const { mask, mag } = buildPaperMask(data, w, h);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (!mask[y * w + x]) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (hits < w * h * 0.06 || maxX <= minX || maxY <= minY) return null;
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw * bh < w * h * 0.12 || bw * bh > w * h * 0.94) return null;

  const padX = Math.max(2, Math.round(bw * 0.02));
  const padY = Math.max(2, Math.round(bh * 0.02));
  minX = clamp(minX - padX, 0, w - 1);
  minY = clamp(minY - padY, 0, h - 1);
  maxX = clamp(maxX + padX, 0, w - 1);
  maxY = clamp(maxY + padY, 0, h - 1);

  const corners: Quad = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const score = scoreQuad(corners, w, h, mag, { preferLarge: true, filledFrac: hits / (w * h) });
  if (score == null || score < 0.32) return null;

  const inv = 1 / scale;
  return {
    corners: corners.map((p) => ({ x: p.x * inv, y: p.y * inv })) as Quad,
    confidence: clamp(score, 0.28, 0.78),
    workWidth: w,
    workHeight: h,
  };
}

/**
 * Detect a document quad in an image/video frame.
 * Returns corners in the *source* pixel space of the drawn image.
 * Confidence < ~0.4 means soft/uncertain — UI should allow corner adjust.
 */
export function detectDocumentQuad(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): DetectResult | null {
  const work = readWorkImage(source, sourceWidth, sourceHeight);
  if (!work) return null;
  const { w, h, scale, data } = work;
  const { mask, gray, mag } = buildPaperMask(data, w, h);

  const paper = quadFromLargestPaperRegion(mask, gray, mag, w, h);
  const edges = quadFromSobelEdges(gray, mag, w, h);

  let best: { corners: Quad; score: number } | null = null;
  if (paper) best = paper;
  // Sobel contours often latch onto text columns — only win over paper when
  // clearly stronger and geometrically sane.
  if (
    edges &&
    isSaneDocumentQuad(edges.corners, w, h) &&
    (!paper || edges.score > paper.score * 1.18)
  ) {
    best = edges;
  }

  const inv = 1 / scale;
  const toSource = (corners: Quad): Quad =>
    corners.map((p) => ({
      x: clamp(p.x * inv, 0, sourceWidth - 1),
      y: clamp(p.y * inv, 0, sourceHeight - 1),
    })) as Quad;

  if (best) {
    const refined = refineQuadToGradients(best.corners, gray, w, h);
    const refinedScore = scoreQuad(refined, w, h, mag, { preferLarge: true });
    if (
      refinedScore != null &&
      refinedScore >= best.score * 0.92 &&
      isSaneDocumentQuad(refined, w, h)
    ) {
      best = { corners: refined, score: Math.max(best.score, refinedScore) };
    }
    if (!isSaneDocumentQuad(best.corners, w, h)) {
      best = null;
    }
  }

  const bright = detectBrightDocumentQuad(source, sourceWidth, sourceHeight);
  // bright.corners are already in source space — compare in work space via scale.
  if (
    bright &&
    isSaneDocumentQuad(bright.corners, sourceWidth, sourceHeight) &&
    (!best || bright.confidence > best.score + 0.04)
  ) {
    return bright;
  }

  if (best) {
    const confidence = clamp(best.score, 0, 1);
    // Require solid score before trusting auto-crop.
    if (confidence >= 0.42 && isSaneDocumentQuad(best.corners, w, h)) {
      return { corners: toSource(best.corners), confidence, workWidth: w, workHeight: h };
    }
    // Uncertain: inset guide at low confidence so UI offers adjustable corners
    // instead of applying a wrong crop.
    return {
      corners: defaultGuideQuad(sourceWidth, sourceHeight),
      confidence: Math.min(confidence, 0.28),
      workWidth: w,
      workHeight: h,
    };
  }

  if (bright) return bright;

  return {
    corners: defaultGuideQuad(sourceWidth, sourceHeight),
    confidence: 0.16,
    workWidth: w,
    workHeight: h,
  };
}

/** How far two quads differ (normalized 0 = identical). */
export function quadDrift(a: Quad, b: Quad, frameW: number, frameH: number) {
  const diag = Math.hypot(frameW, frameH) || 1;
  let sum = 0;
  for (let i = 0; i < 4; i += 1) sum += dist(a[i], b[i]);
  return sum / (4 * diag);
}

/** Split a spread quad into left and right page quads along the vertical midline. */
export function splitQuadVertical(corners: Quad): { left: Quad; right: Quad } {
  const [tl, tr, br, bl] = corners;
  const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const botMid = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
  return {
    left: [tl, topMid, botMid, bl],
    right: [topMid, tr, br, botMid],
  };
}

/**
 * Optional mild book-curve flatten: vertical squeeze toward vertical center line.
 * Cheap heuristic — not full vFlat AI.
 */
export async function mildCurveFlattenJpeg(
  bytes: Uint8Array,
  width: number,
  height: number,
  strength = 0.12,
  quality = 0.88,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (strength <= 0) return { bytes, width, height };
  const blob = new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bmp.close();
    return { bytes, width, height };
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const src = ctx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const cx = (width - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x - cx) / cx;
      const vy = (y / Math.max(1, height - 1) - 0.5) * 2;
      const pull = 1 - strength * (1 - nx * nx) * (1 - Math.abs(vy) * 0.35);
      const sx = clamp(cx + (x - cx) / pull, 0, width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const di = (y * width + x) * 4;
      const i0 = (y * width + x0) * 4;
      const i1 = (y * width + x1) * 4;
      for (let c = 0; c < 3; c += 1) {
        out.data[di + c] = Math.round(src.data[i0 + c] * (1 - fx) + src.data[i1 + c] * fx);
      }
      out.data[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const outBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!outBlob) return { bytes, width, height };
  return { bytes: new Uint8Array(await outBlob.arrayBuffer()), width, height };
}

export function defaultCorners(w: number, h: number): Quad {
  return defaultGuideQuad(w, h);
}
