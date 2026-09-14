"use client";

import { useEffect, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import {
  persistTheme,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = resolveTheme();
    setTheme(next);
    setReady(true);
  }, []);

  const nextTheme: ThemePreference = theme === "dark" ? "light" : "dark";
  const label = nextTheme === "dark" ? "Switch to dark mode" : "Switch to light mode";

  return (
    <button
      type="button"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-slate text-on-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-sky-600/40 dark:border-transparent dark:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white ${className}`}
      aria-label={label}
      title={label}
      disabled={!ready}
      onClick={() => {
        persistTheme(nextTheme);
        setTheme(nextTheme);
      }}
    >
      <MaterialIcon name={theme === "dark" ? "light_mode" : "dark_mode"} className="text-[20px]" />
    </button>
  );
}
