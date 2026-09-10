export function downloadBrowserFile(contents: Blob | BlobPart, fileName: string) {
  const blob = contents instanceof Blob ? contents : new Blob([contents]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadGeneratedFile(
  contents: Blob | BlobPart,
  fileName: string,
  mimeType = "application/pdf",
) {
  const blob =
    contents instanceof Blob
      ? contents
      : new Blob([contents], { type: mimeType });
  downloadBrowserFile(blob, fileName);
}

export function safeBaseName(fileName: string) {
  return (
    fileName
      .replace(/\.(pdf|zip|docx|txt|png|jpe?g|webp)$/i, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
