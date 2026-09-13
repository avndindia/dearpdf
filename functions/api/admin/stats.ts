import { requireAdmin } from "../../_shared/auth";
import { STAT_TOOLS, TOOL_LABELS, json, type Env, type StatEventType, type StatTool } from "../../_shared/env";

type RangeKey = "7d" | "30d" | "90d";

const RANGES: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90 };
const IST = "Asia/Kolkata";

function jsonSafe(data: unknown, status = 200) {
  return json(data, status);
}

function istParts(ts: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ts));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function ymdToUtcMs(ymd: string) {
  return Date.parse(`${ymd}T00:00:00+05:30`);
}

function addDaysYmd(ymd: string, days: number) {
  const next = new Date(ymdToUtcMs(ymd) + days * 86_400_000);
  return istParts(next.getTime()).ymd;
}

function weekdayIndex(ymd: string) {
  const ist = new Date(ymdToUtcMs(ymd));
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "short" }).format(ist);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
}

function mondayOf(ymd: string) {
  const idx = weekdayIndex(ymd);
  return addDaysYmd(ymd, -(idx < 0 ? 0 : idx));
}

function formatDayLabel(ymd: string) {
  const dt = new Date(ymdToUtcMs(ymd));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "short",
  }).format(dt);
}

function formatWeekLabel(startYmd: string) {
  const endYmd = addDaysYmd(startYmd, 6);
  const start = formatDayLabel(startYmd);
  const end = formatDayLabel(endYmd);
  return `${start} – ${end}`;
}

function emptyCounts() {
  return { open: 0, start: 0, success: 0, error: 0, cancel: 0 };
}

type Counts = ReturnType<typeof emptyCounts>;

function addCount(target: Counts, type: string, n: number) {
  if (type in target) target[type as StatEventType] += n;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return jsonSafe({ error: "Stats database is not bound" }, 503);

  const url = new URL(request.url);
  const rawRange = url.searchParams.get("range") ?? "7d";
  const range: RangeKey = rawRange in RANGES ? (rawRange as RangeKey) : "7d";
  const days = RANGES[range];

  const now = Date.now();
  const today = istParts(now).ymd;
  const startYmd = addDaysYmd(today, -(days - 1));
  const since = ymdToUtcMs(startYmd);

  const [totalsRow, sessionRow, toolRows, dailyRows, recentRows] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COUNT(*) AS events,
         SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) AS opens,
         SUM(CASE WHEN event_type = 'start' THEN 1 ELSE 0 END) AS starts,
         SUM(CASE WHEN event_type = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) AS error,
         SUM(CASE WHEN event_type = 'cancel' THEN 1 ELSE 0 END) AS cancel
       FROM events WHERE ts >= ?`,
    )
      .bind(since)
      .first<{
        events: number;
        opens: number;
        starts: number;
        success: number;
        error: number;
        cancel: number;
      }>(),
    env.DB.prepare("SELECT COUNT(DISTINCT session_id) AS sessions FROM events WHERE ts >= ?")
      .bind(since)
      .first<{ sessions: number }>(),
    env.DB.prepare(
      `SELECT tool, event_type, COUNT(*) AS n
       FROM events WHERE ts >= ?
       GROUP BY tool, event_type`,
    )
      .bind(since)
      .all<{ tool: string; event_type: string; n: number }>(),
    env.DB.prepare(
      `SELECT date(ts / 1000, 'unixepoch', '+330 minutes') AS day,
              event_type,
              COUNT(*) AS n,
              COUNT(DISTINCT session_id) AS sessions
       FROM events WHERE ts >= ?
       GROUP BY day, event_type`,
    )
      .bind(since)
      .all<{ day: string; event_type: string; n: number; sessions: number }>(),
    env.DB.prepare(
      `SELECT ts, tool, event_type, session_id
       FROM events
       ORDER BY ts DESC
       LIMIT 40`,
    ).all<{ ts: number; tool: string; event_type: string; session_id: string }>(),
  ]);

  const starts = Number(totalsRow?.starts ?? 0);
  const errors = Number(totalsRow?.error ?? 0);
  const cancels = Number(totalsRow?.cancel ?? 0);

  const toolMap = new Map<string, Counts>();
  for (const tool of STAT_TOOLS) toolMap.set(tool, emptyCounts());
  for (const row of toolRows.results ?? []) {
    if (!toolMap.has(row.tool)) toolMap.set(row.tool, emptyCounts());
    addCount(toolMap.get(row.tool) as Counts, row.event_type, Number(row.n));
  }

  const tools = [...toolMap.entries()]
    .map(([tool, counts]) => {
      const runCount = counts.start;
      return {
        tool,
        label: TOOL_LABELS[tool as StatTool] ?? tool,
        opens: counts.open,
        starts: counts.start,
        success: counts.success,
        error: counts.error,
        cancel: counts.cancel,
        runs: runCount,
        errorRate: runCount ? counts.error / runCount : 0,
        cancelRate: runCount ? counts.cancel / runCount : 0,
      };
    })
    .sort((a, b) => b.runs - a.runs || b.opens - a.opens || a.label.localeCompare(b.label));

  const dailyMap = new Map<string, Counts & { sessions: number }>();
  for (let i = 0; i < days; i++) {
    const ymd = addDaysYmd(startYmd, i);
    dailyMap.set(ymd, { ...emptyCounts(), sessions: 0 });
  }
  const sessionByDay = new Map<string, number>();
  for (const row of dailyRows.results ?? []) {
    const bucket = dailyMap.get(row.day);
    if (!bucket) continue;
    addCount(bucket, row.event_type, Number(row.n));
    sessionByDay.set(row.day, Math.max(sessionByDay.get(row.day) ?? 0, Number(row.sessions)));
  }
  for (const [day, sessions] of sessionByDay) {
    const bucket = dailyMap.get(day);
    if (bucket) bucket.sessions = sessions;
  }

  const daily = [...dailyMap.entries()].map(([date, counts]) => ({
    date,
    label: formatDayLabel(date),
    opens: counts.open,
    runs: counts.start,
    success: counts.success,
    error: counts.error,
    cancel: counts.cancel,
    sessions: counts.sessions,
  }));

  const weekMap = new Map<string, Counts & { sessions: number }>();
  for (const day of daily) {
    const weekStart = mondayOf(day.date);
    const current = weekMap.get(weekStart) ?? { ...emptyCounts(), sessions: 0 };
    current.open += day.opens;
    current.start += day.runs;
    current.success += day.success;
    current.error += day.error;
    current.cancel += day.cancel;
    current.sessions += day.sessions;
    weekMap.set(weekStart, current);
  }
  const weekly = [...weekMap.entries()].map(([week, counts]) => ({
    week,
    label: formatWeekLabel(week),
    opens: counts.open,
    runs: counts.start,
    success: counts.success,
    error: counts.error,
    cancel: counts.cancel,
    sessions: counts.sessions,
  }));

  const recent = (recentRows.results ?? []).map((row) => ({
    ts: Number(row.ts),
    tool: row.tool,
    label: TOOL_LABELS[row.tool as StatTool] ?? row.tool,
    event_type: row.event_type,
    session_id: row.session_id.slice(0, 8),
  }));

  return jsonSafe({
    range,
    timezone: IST,
    generatedAt: now,
    startDate: startYmd,
    endDate: today,
    totals: {
      events: Number(totalsRow?.events ?? 0),
      opens: Number(totalsRow?.opens ?? 0),
      runs: starts,
      success: Number(totalsRow?.success ?? 0),
      error: errors,
      cancel: cancels,
      uniqueSessions: Number(sessionRow?.sessions ?? 0),
      errorRate: starts ? errors / starts : 0,
      cancelRate: starts ? cancels / starts : 0,
    },
    daily,
    weekly,
    tools,
    popular: tools.filter((tool) => tool.runs > 0 || tool.opens > 0).slice(0, 8),
    recent,
  });
};
