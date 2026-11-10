// Envio pelo canal escolhido. Regra de ouro: envio sem confirmação
// fica "incerto" e NUNCA é repetido sozinho. Melhor a equipe conferir do que mandar duas vezes.
import { appendMessage, applyDeliveryStatus, indexOutgoing, markSeen, updateConversation, updateMessage } from "./conversations.js";
import { logError } from "./log.js";
import { autoReplyDecision, manualSendDecision } from "./modes.js";
import { getSettings } from "./settings.js";

// Quando a ponte WAHA devolve o nosso próprio envio como "mensagem minha", não é a equipe.
export function createEchoTracker(ttlMs = 120_000) {
  const pending = [];
  const indexOf = (chatId, text, now) => pending.findIndex((item) => item.chatId === chatId && item.text === text && now.getTime() - item.at < ttlMs);
  return {
    expect(chatId, text, now) {
      pending.push({ chatId, text, at: now.getTime() });
    },
    consume(chatId, text, now) {
      const index = indexOf(chatId, text, now);
      if (index === -1) return false;
      pending.splice(index, 1);
      return true;
    },
    forget(chatId, text, now) {
      const index = indexOf(chatId, text, now);
      if (index !== -1) pending.splice(index, 1);
    },
  };
}

export function setAttention(runtime, conversationId, reason, urgent = false) {
  updateConversation(runtime.store, conversationId, { attention: { reason, urgent, at: runtime.clock().toISOString() } });
}

async function sendThroughChannel(runtime, conversation, text, template) {
  try {
    const result = template
      ? await runtime.channel.sendTemplate(conversation, template.name, template.parameters)
      : await runtime.channel.sendText(conversation, text);
    const externalId = result?.externalId ?? null;
    return { externalId, changes: { status: "sent", externalId } };
  } catch (error) {
    logError("send_failed", error, { conversationId: conversation.id, channel: runtime.channel.name });
    if (error.uncertain) {
      return { externalId: null, changes: { status: "uncertain", error: error.message }, problem: "Envio sem confirmação do WhatsApp. Confira no celular antes de reenviar (nada é reenviado sozinho)." };
    }
    return { externalId: null, changes: { status: "failed", error: error.message }, problem: `Mensagem não enviada: ${error.message}` };
  }
}

export async function deliver(runtime, conversation, text, { author, meta = {}, template = null }) {
  const { store, bus } = runtime;
  const settings = getSettings(store, runtime.config);
  const decision = author === "team" ? manualSendDecision(settings) : autoReplyDecision(settings, conversation.phone);
  if (!decision.allowed) return { blocked: decision.reason };
  // Conversa criada por outro canal (ex.: simulador) nunca sai pelo WhatsApp de verdade.
  if (conversation.channel !== runtime.channel.name) return { blocked: "Esta conversa veio de outro canal e não pode ser enviada por este." };
  const now = runtime.clock();
  const message = appendMessage(store, conversation.id, { author, text, kind: "text", status: "sending", createdAt: now.toISOString(), meta });
  runtime.echoes.expect(conversation.chatId, text, now);
  const outcome = await sendThroughChannel(runtime, conversation, text, template);
  runtime.echoes.forget(conversation.chatId, text, runtime.clock());
  if (outcome.externalId) {
    markSeen(store, outcome.externalId);
    indexOutgoing(store, outcome.externalId, conversation.id, message.id);
  }
  updateMessage(store, conversation.id, message.id, outcome.changes);
  if (outcome.problem) setAttention(runtime, conversation.id, outcome.problem);
  bus.emit("update", { conversationId: conversation.id });
  return { messageId: message.id, status: outcome.changes.status };
}

export function handleStatuses(runtime, statuses) {
  for (const status of statuses) {
    const conversationId = applyDeliveryStatus(runtime.store, status);
    if (conversationId) runtime.bus.emit("update", { conversationId });
  }
}
