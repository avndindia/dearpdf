export async function readFileBytes(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export function readableError(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
