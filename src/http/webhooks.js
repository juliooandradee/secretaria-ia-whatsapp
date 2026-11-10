// Entrada das mensagens do WhatsApp. Cada canal tem a sua verificação de origem.
import { handleInbound } from "../assistant.js";
import { parseOfficialWebhook, verifySignature, verifySubscription } from "../channels/official.js";
import { parseWahaWebhook, verifyWahaSecret } from "../channels/waha.js";
import { handleStatuses } from "../delivery.js";
import { logError } from "../log.js";
import { fail, ok, route } from "./router.js";

async function processBatch(runtime, { messages, statuses }) {
  for (const message of messages) {
    if (!message.phone && runtime.channel.resolvePhone) {
      message.phone = await runtime.channel.resolvePhone(message.chatId).catch((error) => {
        logError("resolve_phone_failed", error);
        return null;
      });
    }
    await handleInbound(runtime, message);
  }
  handleStatuses(runtime, statuses);
  return ok({ received: messages.length, statuses: statuses.length });
}

function officialVerify(runtime, { url, response }) {
  const challenge = runtime.channel.name === "oficial" ? verifySubscription(url.searchParams, runtime.config.meta.verifyToken) : null;
  if (!challenge) return fail(403, "Token de verificação inválido.");
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end(challenge);
  return undefined;
}

function officialReceive(runtime, { request, rawBody, body }) {
  if (runtime.channel.name !== "oficial") return fail(404, "Canal oficial desligado.");
  if (!verifySignature(rawBody, request.headers["x-hub-signature-256"], runtime.config.meta.appSecret)) return fail(401, "Assinatura inválida.");
  return processBatch(runtime, parseOfficialWebhook(body));
}

function wahaReceive(runtime, { request, body }) {
  if (runtime.channel.name !== "waha") return fail(404, "Canal WAHA desligado.");
  if (!verifyWahaSecret(request.headers["x-webhook-secret"], runtime.config.waha.webhookSecret)) return fail(401, "Segredo do webhook inválido.");
  return processBatch(runtime, parseWahaWebhook(body, runtime.config.waha.session));
}

export function webhookRoutes(runtime) {
  return [
    route("GET", "/health", () => ok({ ok: true, channel: runtime.channel.name }), { public: true }),
    route("GET", "/webhooks/oficial", (input) => officialVerify(runtime, input), { public: true }),
    route("POST", "/webhooks/oficial", (input) => officialReceive(runtime, input), { public: true }),
    route("POST", "/webhooks/waha", (input) => wahaReceive(runtime, input), { public: true }),
  ];
}
