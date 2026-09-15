"use client";

import { useEffect, useRef } from "react";

const DATABASE_NAME = "dearpdf-pdf-tools";
const STORE_NAME = "handoffs";
const PARAMETER_NAME = "pdfHandoff";
const MAX_AGE_MS = 30 * 60 * 1000;

type StoredPdf = {
  id: string;
  name: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
  createdAt: number;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Temporary PDF storage is unavailable."));
  });
}

export async function savePdfToolHandoff(bytes: Uint8Array, name: string) {
  const database = await openDatabase();
  const id = crypto.randomUUID();
  const record: StoredPdf = {
    id,
    name,
    // Raw bytes survive iOS Safari's IndexedDB structured cloning more
    // reliably than a Blob. `blob` remains supported when reading older rows.
    bytes: bytes.slice().buffer,
    createdAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(record);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = cursor.value as StoredPdf;
      if (Date.now() - value.createdAt > MAX_AGE_MS) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The PDF could not be prepared for the next tool."));
  });
  database.close();
  return id;
}

async function consumePdfToolHandoff(id: string) {
  const database = await openDatabase();
  const record = await new Promise<StoredPdf | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    let value: StoredPdf | undefined;
    request.onsuccess = () => {
      value = request.result as StoredPdf | undefined;
      if (value) store.delete(id);
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? new Error("The temporary PDF could not be opened."));
  });
  database.close();
  if (!record || Date.now() - record.createdAt > MAX_AGE_MS) return null;
  const contents = record.bytes ?? record.blob;
  if (!contents) return null;
  const bytes = contents instanceof Blob
    ? new Uint8Array(await contents.arrayBuffer())
    : new Uint8Array(contents);
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
  if (!header.includes("%PDF-")) return null;
  return new File([bytes.slice().buffer], record.name, { type: "application/pdf" });
}

export function useIncomingPdfHandoff(
  onFile: (file: File) => void | Promise<void>,
  onFiles?: (files: File[]) => void | Promise<void>,
) {
  const onFileRef = useRef(onFile);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFileRef.current = onFile;
    onFilesRef.current = onFiles;
  }, [onFile, onFiles]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const idParam = url.searchParams.get(PARAMETER_NAME);
    if (!idParam) return;
    url.searchParams.delete(PARAMETER_NAME);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const ids = idParam.split(",").map((id) => id.trim()).filter(Boolean);
    void (async () => {
      const incoming: File[] = [];
      for (const id of ids) {
        const file = await consumePdfToolHandoff(id);
        if (file) incoming.push(file);
      }
      if (!incoming.length) return;
      if (incoming.length > 1 && onFilesRef.current) {
        await onFilesRef.current(incoming);
        return;
      }
      for (const file of incoming) {
        await onFileRef.current(file);
      }
    })();
  }, []);
}

export function pdfToolHandoffUrl(path: string, id: string) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set(PARAMETER_NAME, id);
  return `${url.pathname}${url.search}`;
}
