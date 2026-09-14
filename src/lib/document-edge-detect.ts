/**
 * Lightweight on-device document quad detector (no OpenCV CDN).
 * Downsamples the frame, runs Sobel + threshold + contour approx, returns
 * ordered corners in source image coordinates: TL, TR, BR, BL.
 */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type DetectResult = {
  corners: Quad;
  /** 0–1 rough confidence from area + rectangularity */
  confidence: number;
  /** Working canvas size used for detection */
  workWidth: number;
  workHeight: number;
};

const WORK_MAX = 320;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderCorners(pts: Point[]): Quad {
  // Sort by y then x; split top/bottom; order left→right.
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

/** Trace external contour of a filled component starting at seed (edge-following). */
function traceContour(bin: Uint8Array, w: number, h: number, sx: number, sy: number, visited: Uint8Array) {
  // Moore neighborhood clockwise from west.
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
    // Start search from dir-1 (prefer left turns for outer).
    for (let k = 0; k < 8; k += 1) {
      const nd = (dir + 6 + k) % 8; // start slightly back
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
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return { count, minX, maxX, minY, maxY };
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
    const dist = Math.abs(abx * (a.y - p.y) - (a.x - p.x) * aby) / abLen;
    if (dist > maxDist) {
      maxDist = dist;
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

function bestQuadFromContour(contour: Point[], w: number, h: number): { corners: Quad; score: number } | null {
  if (contour.length < 20) return null;
  // Resample contour to reduce noise.
  const step = Math.max(1, Math.floor(contour.length / 120));
  const sampled: Point[] = [];
  for (let i = 0; i < contour.length; i += step) sampled.push(contour[i]);
  if (sampled.length < 4) return null;

  const epsilon = Math.max(3, Math.min(w, h) * 0.02);
  let approx = douglasPeucker([...sampled, sampled[0]], epsilon).slice(0, -1);

  // If not ~4 points, try coarser / finer epsilon.
  if (approx.length !== 4) {
    approx = douglasPeucker([...sampled, sampled[0]], epsilon * 1.8).slice(0, -1);
  }
  if (approx.length !== 4) {
    approx = douglasPeucker([...sampled, sampled[0]], epsilon * 0.7).slice(0, -1);
  }

  let corners: Quad;
  if (approx.length === 4) {
    corners = orderCorners(approx);
  } else {
    // Fallback: extreme points (min/max x+y, x-y).
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
    corners = [tl, tr, br, bl];
  }

  const area = polygonArea(corners);
  const frameArea = w * h;
  const areaRatio = area / frameArea;
  if (areaRatio < 0.08 || areaRatio > 0.985) return null;

  // Rectangularity: compare side ratios and angles loosely.
  const [tl, tr, br, bl] = corners;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return null;
  const widthRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const heightRatio = Math.min(left, right) / Math.max(left, right);
  if (widthRatio < 0.38 || heightRatio < 0.38) return null;

  const score = areaRatio * 0.55 + widthRatio * 0.225 + heightRatio * 0.225;
  return { corners, score };
}

function defaultGuideQuad(w: number, h: number): Quad {
  // Slightly tighter inset so failed edge-detect still crops desk margins.
  const ix = w * 0.1;
  const iy = h * 0.12;
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ];
}


/**
 * Fallback when Sobel contours miss: find a bright document-like region vs dark desk.
 * Returns a padded axis-aligned quad in source coordinates.
 */
export function detectBrightDocumentQuad(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): DetectResult | null {
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

  // Border sample = desk colour estimate.
  const border: number[] = [];
  const pushLuma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    border.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  };
  for (let x = 0; x < w; x += 2) {
    pushLuma(x, 0);
    pushLuma(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    pushLuma(0, y);
    pushLuma(w - 1, y);
  }
  border.sort((a, b) => a - b);
  const desk = border[Math.floor(border.length * 0.5)] ?? 40;
  const brightCut = Math.min(210, desk + 28);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = (y * w + x) * 4;
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luma < brightCut) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const areaRatio = hits / (w * h);
  if (hits < w * h * 0.04 || maxX <= minX || maxY <= minY) return null;
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw * bh < w * h * 0.1 || bw * bh > w * h * 0.96) return null;

  const padX = Math.max(2, Math.round(bw * 0.03));
  const padY = Math.max(2, Math.round(bh * 0.03));
  minX = clamp(minX - padX, 0, w - 1);
  minY = clamp(minY - padY, 0, h - 1);
  maxX = clamp(maxX + padX, 0, w - 1);
  maxY = clamp(maxY + padY, 0, h - 1);

  const inv = 1 / scale;
  const corners: Quad = [
    { x: minX * inv, y: minY * inv },
    { x: maxX * inv, y: minY * inv },
    { x: maxX * inv, y: maxY * inv },
    { x: minX * inv, y: maxY * inv },
  ];
  const confidence = clamp(0.28 + areaRatio * 0.45, 0.28, 0.72);
  return { corners, confidence, workWidth: w, workHeight: h };
}

/**
 * Detect a document quad in an image/video frame.
 * Returns corners in the *source* pixel space of the drawn image.
 */
export function detectDocumentQuad(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): DetectResult | null {
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

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  const blurred = boxBlurGray(gray, w, h, 1);
  const mag = sobelMagnitude(blurred, w, h);

  // Adaptive threshold from mean magnitude.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i] > 0) {
      sum += mag[i];
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  const thresh = Math.max(18, mean * 1.18);

  let bin = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i += 1) bin[i] = mag[i] >= thresh ? 1 : 0;
  bin = dilateBinary(bin, w, h);
  bin = dilateBinary(bin, w, h);
  bin = erodeBinary(bin, w, h);

  // Find largest edge component that doesn't hug the border too tightly as noise.
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
      if (region.count < (w * h) * 0.006) continue;

      // Find a border pixel of this component to start contour.
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
      const contour = traceContour(
        (() => {
          // Contour mask = this label only.
          const mask = new Uint8Array(w * h);
          for (let k = 0; k < label.length; k += 1) if (label[k] === id) mask[k] = 1;
          return mask;
        })(),
        w,
        h,
        sx,
        sy,
        visitedContour,
      );
      if (!contour) continue;
      const quad = bestQuadFromContour(contour, w, h);
      if (quad && (!best || quad.score > best.score)) best = quad;
    }
  }

  const inv = 1 / scale;
  if (best) {
    const corners: Quad = best.corners.map((p) => ({
      x: clamp(p.x * inv, 0, sourceWidth - 1),
      y: clamp(p.y * inv, 0, sourceHeight - 1),
    })) as Quad;
    const confidence = clamp(best.score, 0, 1);
    if (confidence >= 0.34) {
      return { corners, confidence, workWidth: w, workHeight: h };
    }
    const bright = detectBrightDocumentQuad(source, sourceWidth, sourceHeight);
    if (bright && bright.confidence > confidence) return bright;
    return { corners, confidence, workWidth: w, workHeight: h };
  }

  const bright = detectBrightDocumentQuad(source, sourceWidth, sourceHeight);
  if (bright) return bright;

  // Soft fallback guide — low confidence so auto-scan won't fire.
  const guide = defaultGuideQuad(sourceWidth, sourceHeight);
  return {
    corners: guide,
    confidence: 0.18,
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
      // Pull columns slightly toward center, stronger near mid-height (page gutter feel).
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
