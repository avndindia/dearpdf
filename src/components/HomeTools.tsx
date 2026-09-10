"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { categories, tools, type ToolCategoryId } from "@/lib/catalog";

export default function HomeTools() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ToolCategoryId | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (filter !== "all" && tool.category !== filter) return false;
      if (!q) return true;
      const hay = [
        tool.title,
        tool.job,
        tool.description,
        ...tool.keywords,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, filter]);

  const grouped = categories
    .map((category) => ({
      ...category,
      tools: filtered.filter((tool) => tool.category === category.id),
    }))
    .filter((category) => category.tools.length);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Search tools</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools — merge, compress, OCR…"
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] shadow-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ToolCategoryId | "all")}
          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)] shadow-sm"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.title}
            </option>
          ))}
        </select>
      </div>

      {!grouped.length ? (
        <p className="text-[var(--muted)]">No tools match that search.</p>
      ) : (
        grouped.map((category) => (
          <section key={category.id} className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
                {category.title}
              </h2>
              <p className="text-[var(--muted)]">{category.blurb}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {category.tools.map((tool) => (
                <Link
                  key={tool.slug}
                  href={`/tools/${tool.slug}`}
                  className="group rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                      {tool.title}
                    </h3>
                    {tool.limit === "partial" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Partial
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {tool.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
