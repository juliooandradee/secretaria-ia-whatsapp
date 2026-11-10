// WAHA: API NÃO oficial. Conecta um WhatsApp comum lendo um QR code (como o WhatsApp Web).
// Rápido para começar, mas pode desconectar e há risco de restrição do número.
// Use um número dedicado à clínica. Documentação: https://waha.devlike.pro
import { phoneFromChatId } from "../phone.js";
import { requestJson, safeEqual } from "./http.js";

const DIRECT_CHAT = /@(c\.us|lid|s\.whatsapp\.net)$/;
const ACK_MAP = { "-1": "failed", 1: "sent", 2: "delivered", 3: "read", 4: "read" };
export const WAHA_EVENTS = ["message.any", "message.ack", "session.status"];

export function createWahaChannel(config) {
  const { url, apiKey, session, webhookSecret } = config.waha;
  const headers = { "X-Api-Key": apiKey };
  const call = (path, body, method = "POST") => requestJson(`${url}${path}`, { method, body, headers });
  return {
    name: "waha",
    label: "WAHA (não oficial)",
    async sendText(conversation, text) {
      const result = await call("/api/sendText", { session, chatId: conversation.chatId, text, linkPreview: true });
      // No motor WEBJS o id vem como objeto; o webhook usa o id serializado.
      return { externalId: typeof result?.id === "string" ? result.id : result?.id?._serialized ?? null };
    },
    async markReadAndTyping(conversation) {
      await call("/api/sendSeen", { session, chatId: conversation.chatId });
      await call("/api/startTyping", { session, chatId: conversation.chatId });
    },
    async stopTyping(conversation) {
      await call("/api/stopTyping", { session, chatId: conversation.chatId });
    },
    // Contatos que chegam como "@lid" não mostram o telefone: o WAHA consulta o número real.
    async resolvePhone(chatId) {
      if (!String(chatId).endsWith("@lid")) return phoneFromChatId(chatId);
      const mapping = await call(`/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(chatId)}`, undefined, "GET");
      return mapping?.lid === chatId ? phoneFromChatId(mapping.pn) : null;
    },
    status: () => sessionStatus(call, session),
    connect: (webhookUrl) => ensureSession({ call, session, webhookUrl, webhookSecret }),
    qrImage: () => fetchQrImage(`${url}/api/${encodeURIComponent(session)}/auth/qr?format=image`, headers),
  };
}

async function sessionStatus(call, session) {
  try {
    const current = await call(`/api/sessions/${encodeURIComponent(session)}`, undefined, "GET");
    return { connected: current?.status === "WORKING", detail: `Sessão ${session}: ${current?.status ?? "desconhecida"}` };
  } catch (error) {
    return { connected: false, detail: error.status === 404 ? "Sessão ainda não criada. Clique em Conectar." : `WAHA indisponível: ${error.message}` };
  }
}

async function fetchQrImage(qrUrl, headers) {
  const response = await fetch(qrUrl, { headers: { ...headers, Accept: "image/png" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

// Cria a sessão com o webhook apontando para este servidor; reinicia se falhou.
async function ensureSession({ call, session, webhookUrl, webhookSecret }) {
  let current = null;
  try {
    current = await call(`/api/sessions/${encodeURIComponent(session)}`, undefined, "GET");
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (!current) {
    const webhooks = [{ url: webhookUrl, events: WAHA_EVENTS, customHeaders: [{ name: "X-Webhook-Secret", value: webhookSecret }] }];
    return call("/api/sessions", { name: session, start: true, config: { webhooks } });
  }
  if (current.status === "FAILED") return call(`/api/sessions/${encodeURIComponent(session)}/restart`, {});
  if (current.status === "STOPPED") return call(`/api/sessions/${encodeURIComponent(session)}/start`, {});
  return current;
}

export function verifyWahaSecret(headerValue, secret) {
  return safeEqual(secret, headerValue);
}

function mapAck(payload) {
  const status = ACK_MAP[String(payload?.ack)];
  return status && payload?.id ? [{ externalId: payload.id, status, error: null }] : [];
}

export function parseWahaWebhook(body, session) {
  const empty = { messages: [], statuses: [] };
  if (!body || body.session !== session) return empty;
  if (body.event === "message.ack") return { messages: [], statuses: mapAck(body.payload) };
  if (body.event !== "message.any" && body.event !== "message") return empty;
  const payload = body.payload ?? {};
  const chatId = payload.fromMe ? payload.to : payload.from;
  if (typeof payload.id !== "string" || !DIRECT_CHAT.test(String(chatId ?? ""))) return empty;
  return {
    statuses: [],
    messages: [{
      channel: "waha",
      externalId: payload.id,
      chatId,
      phone: phoneFromChatId(chatId),
      name: payload.fromMe ? "" : String(payload.pushName || payload.notifyName || payload._data?.notifyName || "").slice(0, 120),
      text: typeof payload.body === "string" ? payload.body.slice(0, 4000) : "",
      kind: payload.hasMedia ? "media" : "text",
      timestamp: Number(payload.timestamp) * 1000,
      fromMe: payload.fromMe === true,
    }],
  };
}
