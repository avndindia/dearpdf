export default function PrivacyChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--wash)] px-3 py-1 text-xs font-medium text-[var(--muted)] ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
      Runs in your browser · Files stay on this device
    </span>
  );
}
