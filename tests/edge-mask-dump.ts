import fs from "fs";
import { PNG } from "pngjs";

class FakeCanvas {
  width = 0; height = 0; private data: Uint8ClampedArray | null = null;
  getContext() {
    const self = this;
    return {
      drawImage(img: any, _x: number, _y: number, w: number, h: number) {
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

// Monkey-patch by reimplementing mask dump inline using exported bright detect + reading work via detect
async function main() {
  // Import after mock
  const mod = await import("../src/lib/document-edge-detect.ts");
  // We'll recreate mask logic by calling detect and also write a simplified dump
  // by reading source pixels at WORK resolution through FakeCanvas path inside detectBrightDocumentQuad
  
  for (const file of ["page-01.png", "page-02.png", "page-07.png"]) {
    const png = PNG.sync.read(fs.readFileSync(`/tmp/scan-bad/${file}`));
    const source = { width: png.width, height: png.height, data: png.data };
    const r = mod.detectDocumentQuad(source as any, png.width, png.height);
    console.log(file, r?.confidence, r?.corners.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}
main();
