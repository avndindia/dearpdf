type MaterialIconProps = {
  name: string;
  className?: string;
  filled?: boolean;
};

/** Material Symbols Outlined glyph (font loaded in root layout). */
export default function MaterialIcon({
  name,
  className = "",
  filled = false,
}: MaterialIconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      aria-hidden
    >
      {name}
    </span>
  );
}
