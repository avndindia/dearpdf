import fs from "fs";
import { PNG } from "pngjs";
import path from "path";

class FakeCanvas {
  width = 0;
  height = 0;
  private data: Uint8ClampedArray | null = null;
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
            const si = (sy * sw + sx) * 4;
            const di = (oy * w + ox) * 4;
            out[di] = img.data[si];
            out[di + 1] = img.data[si + 1];
            out[di + 2] = img.data[si + 2];
            out[di + 3] = 255;
          }
        }
        self.data = out;
        self.width = w;
        self.height = h;
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: self.data!, width: w, height: h };
      },
    };
  }
}

(globalThis as any).document = {
  createElement(tag: string) {
    if (tag === "canvas") return new FakeCanvas();
    throw new Error(`unsupported ${tag}`);
  },
};

async function main() {
  const { detectDocumentQuad, detectBrightDocumentQuad } = await import("../src/lib/document-edge-detect.ts");
  const dir = "/tmp/scan-bad";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  for (const file of files) {
    const buf = fs.readFileSync(path.join(dir, file));
    const png = PNG.sync.read(buf);
    const source = { width: png.width, height: png.height, data: png.data as unknown as Uint8ClampedArray };
    const result = detectDocumentQuad(source as any, png.width, png.height);
    const bright = detectBrightDocumentQuad(source as any, png.width, png.height);
    const c = result?.corners;
    const area = c
      ? Math.abs(
          (c[0].x * (c[1].y - c[3].y) + c[1].x * (c[2].y - c[0].y) + c[2].x * (c[3].y - c[1].y) + c[3].x * (c[0].y - c[2].y)) / 2,
        ) / (png.width * png.height)
      : 0;
    console.log(
      JSON.stringify({
        file,
        size: [png.width, png.height],
        conf: result?.confidence?.toFixed(3),
        area: area.toFixed(3),
        corners: c?.map((p) => [Math.round(p.x), Math.round(p.y)]),
        brightConf: bright?.confidence?.toFixed(3) ?? null,
        brightCorners: bright?.corners?.map((p) => [Math.round(p.x), Math.round(p.y)]) ?? null,
      }),
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
