/** Inline DearPDF lockup — vector mark + HTML wordmark (crisp on Safari retina). */
export default function DearPdfLogo({
  className = "",
  markClassName = "h-11 w-11 sm:h-12 sm:w-12",
  wordmarkClassName = "text-[1.35rem] leading-none sm:text-[1.55rem]",
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <svg
        className={`shrink-0 drop-shadow-[0_2px_6px_rgba(3,105,161,0.28)] ${markClassName}`}
        viewBox="0 0 72 72"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="dpdf_doc" x1="12" y1="6" x2="62" y2="68" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0369A1" />
            <stop offset="1" stopColor="#075985" />
          </linearGradient>
          <linearGradient id="dpdf_fold" x1="40" y1="6" x2="62" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7DD3FC" />
            <stop offset="1" stopColor="#38BDF8" />
          </linearGradient>
        </defs>
        <path
          d="M14 8 C14 5.239 16.239 3 19 3 H40 L62 25 V60 C62 62.761 59.761 65 57 65 H19 C16.239 65 14 62.761 14 60 V8 Z"
          fill="url(#dpdf_doc)"
        />
        <path d="M40 3 L62 25 H48 C44.686 25 42 22.314 42 19 V3 Z" fill="url(#dpdf_fold)" />
        <path d="M42 19 L62 25 H42 Z" fill="#0C4A6E" opacity="0.28" />
        <rect x="20" y="31" width="36" height="17" rx="4.5" fill="#FFFFFF" />
        <text
          x="38"
          y="43.5"
          textAnchor="middle"
          fill="#0369A1"
          fontFamily="var(--font-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="12"
          letterSpacing="0.06em"
        >
          PDF
        </text>
        <rect x="20" y="53" width="20" height="2.75" rx="1.375" fill="#BAE6FD" />
        <rect x="43" y="53" width="13" height="2.75" rx="1.375" fill="#38BDF8" />
      </svg>
      <span
        className={`truncate font-extrabold tracking-tight text-on-surface ${wordmarkClassName}`}
        style={{ fontFamily: "var(--font-jakarta), var(--font-sans), system-ui, sans-serif" }}
      >
        Dear
        <span className="text-sky-700">PDF</span>
        <span className="text-[0.82em] font-extrabold text-sky-700">.in</span>
      </span>
    </span>
  );
}
