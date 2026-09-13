import { createSessionCookie, passwordsMatch, requireAdminSecrets } from "../../_shared/auth";
import { json, type Env } from "../../_shared/env";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireAdminSecrets(env);
  if (missing) return missing;

  let password = "";
  try {
    const text = await request.text();
    if (text.length > 2048) return json({ error: "Invalid request" }, 400);
    const body = JSON.parse(text) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!password || !(await passwordsMatch(password, env.ADMIN_PASSWORD as string))) {
    return json({ error: "Invalid password" }, 401);
  }

  const cookie = await createSessionCookie(env.ADMIN_SESSION_SECRET as string);
  return json({ ok: true }, 200, { "set-cookie": cookie });
};
