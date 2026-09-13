"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import MaterialIcon from "@/components/MaterialIcon";

type RangeKey = "7d" | "30d" | "90d";

type ToolRow = {
  tool: string;
  label: string;
  opens: number;
  starts: number;
  success: number;
  error: number;
  cancel: number;
  runs: number;
  errorRate: number;
  cancelRate: number;
};

type DayRow = {
  date: string;
  label: string;
  opens: number;
  runs: number;
  success: number;
  error: number;
  cancel: number;
  sessions: number;
};

type FeedItem = {
  ts: number;
  tool: string;
  label: string;
  event_type: string;
  session_id: string;
};

type StatsPayload = {
  range: RangeKey;
  timezone: string;
  generatedAt: number;
  startDate: string;
  endDate: string;
  totals: {
    events: number;
    opens: number;
    runs: number;
    success: number;
    error: number;
    cancel: number;
    uniqueSessions: number;
    errorRate: number;
    cancelRate: number;
  };
  daily: DayRow[];
  weekly: Array<DayRow & { week?: string }>;
  tools: ToolRow[];
  popular: ToolRow[];
  recent: FeedItem[];
};

const RANGES: { id: RangeKey; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

const EVENT_LABEL: Record<string, string> = {
  open: "Opened",
  start: "Started",
  success: "Finished",
  error: "Error",
  cancel: "Cancelled",
};

const EVENT_TONE: Record<string, string> = {
  open: "bg-slate-100 text-slate-700",
  start: "bg-blue-50 text-blue-800",
  success: "bg-emerald-50 text-emerald-800",
  error: "bg-red-50 text-red-800",
  cancel: "bg-amber-50 text-amber-800",
};

function formatIst(ts: number, withTime = false) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
  }).format(new Date(ts));
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function BarChart({
  rows,
  valueKey = "runs",
}: {
  rows: Array<{ label: string; runs: number; success?: number; error?: number }>;
  valueKey?: "runs" | "success";
}) {
  const max = Math.max(1, ...rows.map((row) => row[valueKey] ?? row.runs));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {rows.map((row) => {
        const value = row[valueKey] ?? row.runs;
        const height = Math.max(value > 0 ? 8 : 2, Math.round((value / max) * 140));
        return (
          <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="font-mono text-[10px] text-on-surface-variant">{value || ""}</span>
            <div
              className="w-full rounded-t bg-primary-container"
              style={{ height }}
              title={`${row.label}: ${value}`}
            />
            <span className="w-full truncate text-center font-label-sm text-[10px] text-on-surface-variant">
              {row.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configHint, setConfigHint] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadStats = useCallback(async (nextRange: RangeKey, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const response = await fetch(`/api/admin/stats?range=${nextRange}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        setAuthed(false);
        setStats(null);
        if (!silent) setError("");
        return false;
      }
      if (response.status === 503) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setConfigHint(body.error || "Admin password not configured");
        setAuthed(false);
        setStats(null);
        return false;
      }
      if (!response.ok) {
        setError("Could not load analytics.");
        return false;
      }
      const payload = (await response.json()) as StatsPayload;
      setStats(payload);
      setAuthed(true);
      setUpdatedAt(Date.now());
      setError("");
      setConfigHint("");
      return true;
    } catch {
      if (!silent) setError("Could not reach analytics.");
      return false;
    } finally {
      if (!silent) {
        setBusy(false);
        setBooting(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStats(range).finally(() => setBooting(false));
  }, [loadStats, range]);

  useEffect(() => {
    if (!authed) return;
    const timer = window.setInterval(() => {
      void loadStats(range, true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [authed, loadStats, range]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 503) {
        setConfigHint(body.error || "Admin password not configured");
        return;
      }
      if (!response.ok) {
        setError(body.error || "Invalid password");
        return;
      }
      setPassword("");
      await loadStats(range);
    } catch {
      setError("Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    setAuthed(false);
    setStats(null);
  }

  const maxPopular = useMemo(
    () => Math.max(1, ...(stats?.popular ?? []).map((tool) => tool.runs || tool.opens)),
    [stats],
  );

  if (booting) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center text-sm text-on-surface-variant">
        Checking admin session…
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm">
          <p className="font-label-sm text-label-sm uppercase tracking-[0.14em] text-primary">Private</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-on-surface">DearPDF analytics</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Password-protected usage for this site only. No filenames or file contents are stored.
          </p>
          {configHint ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
              {configHint}. Set the <code className="font-mono">ADMIN_PASSWORD</code> secret on the Cloudflare Pages project
              <code className="font-mono"> dearpdf</code>, then retry.
            </p>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={(event) => void login(event)}>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-on-surface">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-on-surface outline-none focus:border-primary"
                  required
                />
              </label>
              {error ? <p className="text-sm text-error" role="alert">{error}</p> : null}
              <button
                type="submit"
                disabled={busy || !password}
                className="inline-flex h-10 items-center justify-center rounded bg-primary-container px-4 font-label-lg text-on-primary disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Unlock"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const totals = stats?.totals;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-label-sm text-label-sm uppercase tracking-[0.14em] text-primary">Private analytics</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-on-surface">Tool activity</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            IST dates · privacy-safe pings only (tool, event, time, anonymous session).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
          <div className="flex rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-0.5">
            {RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRange(item.id)}
                className={
                  range === item.id
                    ? "rounded-md bg-secondary-container px-3 py-1.5 text-xs font-semibold text-on-secondary-fixed"
                    : "rounded-md px-3 py-1.5 text-xs text-on-surface-variant"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void logout()} className="text-sm text-on-surface-variant hover:text-on-surface">
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Runs", value: formatNumber(totals?.runs ?? 0), hint: "Jobs started" },
          { label: "Unique sessions", value: formatNumber(totals?.uniqueSessions ?? 0), hint: "Anonymous browsers" },
          { label: "Error rate", value: formatRate(totals?.errorRate ?? 0), hint: `${formatNumber(totals?.error ?? 0)} errors` },
          { label: "Cancel rate", value: formatRate(totals?.cancelRate ?? 0), hint: `${formatNumber(totals?.cancel ?? 0)} cancelled` },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-on-surface">{card.value}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-on-surface">Daily runs</h2>
            <span className="text-xs text-on-surface-variant">IST</span>
          </div>
          <BarChart rows={stats?.daily ?? []} />
        </div>
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-on-surface">Weekly runs</h2>
            <span className="text-xs text-on-surface-variant">Mon–Sun IST</span>
          </div>
          <BarChart rows={stats?.weekly ?? []} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
          <h2 className="mb-3 font-semibold text-on-surface">Popular tools</h2>
          <ol className="space-y-2">
            {(stats?.popular ?? []).map((tool, index) => (
              <li key={tool.tool} className="flex items-center gap-3">
                <span className="w-5 text-xs text-on-surface-variant">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-on-surface">{tool.label}</span>
                    <span className="font-mono text-xs text-on-surface-variant">{tool.runs} runs</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                    <div
                      className="h-full rounded-full bg-primary-container"
                      style={{ width: `${Math.max(4, ((tool.runs || tool.opens) / maxPopular) * 100)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
            {!stats?.popular.length ? <li className="text-sm text-on-surface-variant">No tool runs in this range yet.</li> : null}
          </ol>
        </div>

        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-on-surface">Live activity</h2>
            <span className="text-xs text-on-surface-variant">
              {updatedAt ? `Updated ${formatIst(updatedAt, true)} IST` : busy ? "Refreshing…" : ""}
            </span>
          </div>
          <ol className="max-h-80 space-y-2 overflow-auto pr-1">
            {(stats?.recent ?? []).map((item, index) => (
              <li key={`${item.ts}-${item.session_id}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-on-surface">{item.label}</p>
                  <p className="text-xs text-on-surface-variant">
                    {formatIst(item.ts, true)} IST · {item.session_id}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EVENT_TONE[item.event_type] ?? "bg-slate-100"}`}>
                  {EVENT_LABEL[item.event_type] ?? item.event_type}
                </span>
              </li>
            ))}
            {!stats?.recent.length ? <li className="text-sm text-on-surface-variant">Waiting for the first privacy-safe ping.</li> : null}
          </ol>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
        <div className="border-b border-outline-variant/30 px-4 py-3">
          <h2 className="font-semibold text-on-surface">Per-tool breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
              <tr>
                {["Tool", "Opens", "Runs", "Success", "Errors", "Cancels", "Error %", "Cancel %"].map((heading) => (
                  <th key={heading} className="px-4 py-2 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(stats?.tools ?? []).map((tool) => (
                <tr key={tool.tool} className="border-t border-outline-variant/20">
                  <td className="px-4 py-2 font-medium text-on-surface">{tool.label}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{tool.opens}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{tool.runs}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{tool.success}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{tool.error}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{tool.cancel}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{formatRate(tool.errorRate)}</td>
                  <td className="px-4 py-2 font-mono text-on-surface-variant">{formatRate(tool.cancelRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="flex items-center gap-2 text-xs text-on-surface-variant">
        <MaterialIcon name="verified_user" className="text-[16px] text-primary" />
        Files never leave the browser. This page only reads anonymous tool events.
      </p>
    </div>
  );
}
