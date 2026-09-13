declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  const pdfjs: any;
  export default pdfjs;
  export const GlobalWorkerOptions: { workerSrc: string };
  export const OPS: Record<string, number>;
  export function getDocument(src: any): any;
}

declare module "qpdf-run/worker";
declare module "qpdf-run/qpdf.js";
declare module "qpdf-run/qpdf.wasm";
