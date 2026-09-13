import { authenticate } from "../../_shared/auth";
import { assertEnv, handle, HttpError, json } from "../../_shared/http";
import { validateConfiguredPlan } from "../../_shared/mercadoPago";
import type { PagesContext } from "../../types";

export function assertPublicKey(value: string) {
  if (
    !/^(?:APP_USR|TEST)-[A-Za-z0-9-]{20,}$/.test(value) ||
    value.length > 256
  )
    throw new HttpError(503, "Chave pública do checkout inválida.");
}

export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    assertEnv(context.env, ["MERCADO_PAGO_PUBLIC_KEY"]);
    await authenticate(context.request, context.env);
    const publicKey = context.env.MERCADO_PAGO_PUBLIC_KEY!;
    assertPublicKey(publicKey);
    await validateConfiguredPlan(context.env);
    return json(
      context.env,
      { publicKey },
      200,
      context.request,
    );
  });
}
