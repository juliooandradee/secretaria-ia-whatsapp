// API oficial do WhatsApp (Meta Cloud API). Mais estável e dentro das regras da Meta;
// mensagens fora da janela de 24 horas exigem modelos (templates) aprovados.
import { createHmac } from "node:crypto";
import { requestJson, safeEqual } from "./http.js";

const STATUS_MAP = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
const IGNORED_TYPES = new Set(["reaction", "system", "unsupported", "ephemeral"]);

export function createOfficialChannel(config) {
  const { accessToken, phoneNumberId, graphVersion, templates } = config.meta;
  const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  const send = (body) => requestJson(endpoint, { body: { messaging_product: "whatsapp", ...body }, headers: { Authorization: `Bearer ${accessToken}` } });
  return {
    name: "oficial",
    label: "API oficial (Meta)",
    async sendText(conversation, text) {
      const result = await send({ recipient_type: "individual", to: conversation.chatId, type: "text", text: { body: text, preview_url: true } });
      return { externalId: result?.messages?.[0]?.id ?? null };
    },
    async sendTemplate(conversation, name, parameters) {
      const components = [{ type: "body", parameters: parameters.map((value) => ({ type: "text", text: String(value) })) }];
      const result = await send({ to: conversation.chatId, type: "template", template: { name, language: { code: templates.language }, components } });
      return { externalId: result?.messages?.[0]?.id ?? null };
    },
    // Marca como lida e mostra "digitando..." (a Meta apaga sozinha ao responder ou em 25 s).
    async markReadAndTyping(conversation) {
      if (!String(conversation.lastInboundExternalId ?? "").startsWith("wamid.")) return;
      await send({ status: "read", message_id: conversation.lastInboundExternalId, typing_indicator: { type: "text" } });
    },
    async status() {
      return { connected: Boolean(accessToken && phoneNumberId), detail: `Número ${phoneNumberId ? `…${phoneNumberId.slice(-4)}` : "não configurado"}` };
    },
  };
}

// GET de verificação que a Meta faz ao cadastrar o webhook.
export function verifySubscription(query, verifyToken) {
  if (query.get("hub.mode") !== "subscribe") return null;
  if (!safeEqual(verifyToken, query.get("hub.verify_token"))) return null;
  const challenge = query.get("hub.challenge") ?? "";
  return challenge.length > 0 && challenge.length <= 1024 ? challenge : null;
}

// Toda notificação vem assinada com o App Secret: X-Hub-Signature-256.
export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signatureHeader);
}

function officialText(message) {
  if (message.type === "text") return message.text?.body ?? "";
  if (message.type === "button") return message.button?.text ?? "";
  if (message.type === "interactive") return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "";
  return message[message.type]?.caption ?? "";
}

function normalizeMessage(message, names) {
  const isText = ["text", "button", "interactive"].includes(message.type);
  return {
    channel: "oficial",
    externalId: message.id,
    chatId: message.from,
    phone: message.from,
    name: names.get(message.from) ?? "",
    text: officialText(message),
    kind: isText ? "text" : message.type,
    timestamp: Number(message.timestamp) * 1000,
    fromMe: false,
  };
}

export function parseOfficialWebhook(body) {
  const messages = [];
  const statuses = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = new Map((value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? ""]));
      for (const message of value.messages ?? []) {
        if (message?.id && message.from && !IGNORED_TYPES.has(message.type)) messages.push(normalizeMessage(message, names));
      }
      for (const status of value.statuses ?? []) {
        if (STATUS_MAP[status.status]) statuses.push({ externalId: status.id, status: STATUS_MAP[status.status], error: status.errors?.[0]?.title ?? null });
      }
    }
  }
  return { messages, statuses };
}
