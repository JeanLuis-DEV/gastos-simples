import type { Env } from "../types";
import { HttpError } from "./http";
export async function rateLimit(
  env: Env,
  key: string,
  limit = 10,
  windowSeconds = 60,
) {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const result = await env.DB.prepare(
    "INSERT INTO rate_limits (key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, bucket)
    .first<{ count: number }>();
  if ((result?.count ?? limit + 1) > limit)
    throw new HttpError(429, "Muitas tentativas. Aguarde e tente novamente.");
}
