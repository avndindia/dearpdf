import { clearCookieHeader } from "../../_shared/auth";
import { json, type Env } from "../../_shared/env";

export const onRequestPost: PagesFunction<Env> = async () => {
  return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
};
