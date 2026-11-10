// Conversas e mensagens. Autores: patient (paciente), ai (IA), team (equipe),
// automation (confirmação/retorno automáticos) e system (anotações internas).
import { newId, stableId } from "./ids.js";

const MAX_MESSAGES = 500;
const MAX_SEEN_IDS = 5000;

export function conversationIdFor(channel, chatId) {
  return stableId("conv", channel, chatId);
}

export function findConversation(store, conversationId) {
  return store.state.conversations[conversationId] ?? null;
}

export function listMessages(store, conversationId) {
  return store.state.messages[conversationId] ?? [];
}

function newConversation({ id, channel, chatId, phone, name, now }) {
  return {
    id, channel, chatId, phone: phone || null, name: name || "",
    owner: "ai", attention: null, unread: 0, generation: 0, securityStrikes: [],
    preview: "", lastMessageAt: now.toISOString(), lastInboundAt: null,
    lastInboundExternalId: null, createdAt: now.toISOString(),
  };
}

export function upsertConversation(store, { channel, chatId, phone, name, now }) {
  const id = conversationIdFor(channel, chatId);
  return store.update((state) => {
    const existing = state.conversations[id];
    if (!existing) {
      state.conversations[id] = newConversation({ id, channel, chatId, phone, name, now });
      state.messages[id] = [];
      return state.conversations[id];
    }
    if (name && !existing.name) existing.name = name;
    if (phone && !existing.phone) existing.phone = phone;
    return existing;
  });
}

function previewOf(message) {
  if (message.text) return message.text.slice(0, 120);
  return message.kind && message.kind !== "text" ? "📎 Anexo" : "";
}

export function appendMessage(store, conversationId, message) {
  return store.update((state) => {
    const list = (state.messages[conversationId] ??= []);
    const stored = { id: newId("m"), status: null, meta: {}, ...message };
    list.push(stored);
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    const conversation = state.conversations[conversationId];
    conversation.lastMessageAt = stored.createdAt;
    if (stored.author !== "system") conversation.preview = previewOf(stored) || conversation.preview;
    if (stored.author === "patient") {
      conversation.unread += 1;
      conversation.lastInboundAt = stored.createdAt;
      conversation.lastInboundExternalId = stored.externalId ?? null;
    }
    return stored;
  });
}

export function updateMessage(store, conversationId, messageId, changes) {
  return store.update((state) => {
    const message = (state.messages[conversationId] ?? []).find((item) => item.id === messageId);
    if (message) Object.assign(message, changes);
    return message ?? null;
  });
}

export function updateConversation(store, conversationId, changes) {
  return store.update((state) => {
    const conversation = state.conversations[conversationId];
    if (conversation) Object.assign(conversation, changes);
    return conversation ?? null;
  });
}

export function bumpGeneration(store, conversationId) {
  return store.update((state) => {
    state.conversations[conversationId].generation += 1;
    return state.conversations[conversationId].generation;
  });
}

// Devolve false quando o evento já foi processado (webhooks chegam repetidos).
export function markSeen(store, externalId) {
  if (!externalId) return true;
  const seen = store.state.seenExternalIds;
  if (seen.includes(externalId)) return false;
  store.update((state) => {
    state.seenExternalIds.push(externalId);
    if (state.seenExternalIds.length > MAX_SEEN_IDS) state.seenExternalIds.splice(0, state.seenExternalIds.length - MAX_SEEN_IDS);
  });
  return true;
}

export function indexOutgoing(store, externalId, conversationId, messageId) {
  if (!externalId) return;
  store.update((state) => {
    state.outgoingIndex[externalId] = { conversationId, messageId };
    const keys = Object.keys(state.outgoingIndex);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SEEN_IDS))) delete state.outgoingIndex[key];
  });
}

const STATUS_ORDER = { sending: 0, sent: 1, delivered: 2, read: 3 };

export function applyDeliveryStatus(store, { externalId, status, error }) {
  const target = store.state.outgoingIndex[externalId];
  if (!target) return null;
  const message = listMessages(store, target.conversationId).find((item) => item.id === target.messageId);
  if (!message) return null;
  const isUpgrade = status === "failed" || (STATUS_ORDER[status] ?? -1) > (STATUS_ORDER[message.status] ?? -1);
  if (isUpgrade) updateMessage(store, target.conversationId, message.id, { status, ...(error ? { error } : {}) });
  return target.conversationId;
}

export function listConversations(store) {
  return Object.values(store.state.conversations).sort((first, second) => second.lastMessageAt.localeCompare(first.lastMessageAt));
}
