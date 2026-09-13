import { onOptions, withSecurityHeaders } from "../_shared/http";
import type { Env } from "../types";
type MiddlewareContext = {
  request: Request;
  env: Env;
  next(): Promise<Response>;
};
export async function onRequest(context: MiddlewareContext) {
  if (context.request.method === "OPTIONS") return onOptions(context);
  return withSecurityHeaders(await context.next());
}
