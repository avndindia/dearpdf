import fs from "fs";
import { PNG } from "pngjs";
import path from "path";

class FakeCanvas {
  width = 0; height = 0; private data: Uint8ClampedArray | null = null;
  getContext() {
    const self = this;
    return {
      drawImage(img: { width: number; height: number; data: Uint8ClampedArray }, _x: number, _y: number, w: number, h: number) {
        const sw = img.width, sh = img.height;
        const out = new Uint8ClampedArray(w * h * 4);
        for (let oy = 0; oy < h; oy++) {
          const sy = Math.min(sh - 1, Math.floor((oy + 0.5) * sh / h));
          for (let ox = 0; ox < w; ox++) {
            const sx = Math.min(sw - 1, Math.floor((ox + 0.5) * sw / w));
            const si = (sy * sw + sx) * 4, di = (oy * w + ox) * 4;
            out[di] = img.data[si]; out[di+1] = img.data[si+1]; out[di+2] = img.data[si+2]; out[di+3] = 255;
          }
        }
        self.data = out; self.width = w; self.height = h;
      },
      getImageData() { return { data: self.data!, width: self.width, height: self.height }; },
    };
  }
}
(globalThis as any).document = { createElement: (t: string) => { if (t==="canvas") return new FakeCanvas(); throw new Error(t); } };

function drawLine(png: PNG, x0: number, y0: number, x1: number, y1: number, color: [number,number,number]) {
  const steps = Math.max(Math.abs(x1-x0), Math.abs(y1-y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) continue;
      const i4 = (yy * png.width + xx) * 4;
      png.data[i4] = color[0]; png.data[i4+1] = color[1]; png.data[i4+2] = color[2]; png.data[i4+3] = 255;
    }
  }
}

async function main() {
  const { detectDocumentQuad } = await import("../src/lib/document-edge-detect.ts");
  const outDir = "/tmp/scan-overlays";
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of ["page-01.png","page-02.png","page-07.png","page-04.png","page-10.png","page-14.png"]) {
    const png = PNG.sync.read(fs.readFileSync(`/tmp/scan-bad/${file}`));
    const source = { width: png.width, height: png.height, data: png.data };
    const result = detectDocumentQuad(source as any, png.width, png.height)!;
    const c = result.corners;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i+1)%4];
      drawLine(png, a.x, a.y, b.x, b.y, [255, 0, 0]);
    }
    // also draw green inset guide for reference
    const ix = png.width * 0.1, iy = png.height * 0.12;
    drawLine(png, ix, iy, png.width-ix, iy, [0,200,0]);
    drawLine(png, png.width-ix, iy, png.width-ix, png.height-iy, [0,200,0]);
    drawLine(png, png.width-ix, png.height-iy, ix, png.height-iy, [0,200,0]);
    drawLine(png, ix, png.height-iy, ix, iy, [0,200,0]);
    fs.writeFileSync(`${outDir}/${file}`, PNG.sync.write(png));
    console.log(file, "conf", result.confidence.toFixed(3), "corners", c.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}
main();
