export async function encryptPdfWithPassword(
  bytes: ArrayBuffer | Uint8Array,
  userPassword: string,
): Promise<Uint8Array> {
  const { createQpdfRunner } = await import("qpdf-run");
  const owner = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const runner = await createQpdfRunner({
    workerUrl: new URL("qpdf-run/worker", import.meta.url),
    qpdfJsUrl: new URL("qpdf-run/qpdf.js", import.meta.url),
    wasmUrl: new URL("qpdf-run/qpdf.wasm", import.meta.url),
    timeoutMs: 120_000,
  });
  try {
    return await runner.runOne({
      input: bytes,
      inputName: "input.pdf",
      outputName: "locked.pdf",
      args: [
        "--encrypt",
        userPassword,
        owner,
        "256",
        "--",
        "input.pdf",
        "locked.pdf",
      ],
    });
  } finally {
    await runner.destroy();
  }
}
