import { EVENT_TYPES, STAT_TOOLS, json, type Env } from "../../_shared/env";

const TOOL_SET = new Set<string>(STAT_TOOLS);
const TYPE_SET = new Set<string>(EVENT_TYPES);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: "Stats database is not bound" }, 503);

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return json({ error: "Payload too large" }, 413);
    payload = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!payload || typeof payload !== "object") return json({ error: "Invalid body" }, 400);
  const body = payload as Record<string, unknown>;
  const tool = typeof body.tool === "string" ? body.tool.trim() : "";
  const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";

  if (!TOOL_SET.has(tool)) return json({ error: "Unknown tool" }, 400);
  if (!TYPE_SET.has(eventType)) return json({ error: "Unknown event type" }, 400);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) return json({ error: "Invalid session" }, 400);

  try {
    await env.DB.prepare(
      "INSERT INTO events (ts, tool, event_type, session_id) VALUES (?, ?, ?, ?)",
    )
      .bind(Date.now(), tool, eventType, sessionId)
      .run();
  } catch {
    return json({ error: "Could not record event" }, 500);
  }

  return json({ ok: true });
};
