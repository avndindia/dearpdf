"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

type Props = {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  onFiles: (files: File[]) => void;
};

export default function DropZone({
  accept,
  multiple,
  disabled,
  label = "Drop a file here, or browse",
  onFiles,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [multiple, onFiles],
  );

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    take(event.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
        over
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--line)] bg-[var(--wash)] hover:border-[var(--accent)]/50"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <p className="text-lg font-medium text-[var(--ink)]">{label}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Processed entirely in this tab. Nothing is uploaded.
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
