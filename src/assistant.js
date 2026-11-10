// O atendimento: recebe a mensagem, decide quem responde (IA ou equipe) e responde no ritmo certo.
import { hasDailyBudget } from "./budget.js";
import { appendMessage, bumpGeneration, findConversation, listConversations, listMessages, markSeen, updateConversation, upsertConversation } from "./conversations.js";
import { deliver, setAttention } from "./delivery.js";
import { detectEmergency, detectPromptInjection, EMERGENCY_REPLY, INJECTION_REPLY, registerStrike } from "./guard.js";
import { logError } from "./log.js";
import { autoReplyDecision } from "./modes.js";
import { typingDelayMs } from "./pacing.js";
import { getSettings } from "./settings.js";
import { replyMeta, thinkReply } from "./think.js";

function emit(runtime, conversationId) {
  runtime.bus.emit("update", { conversationId });
}

export function addSystemNote(runtime, conversationId, text) {
  appendMessage(runtime.store, conversationId, { author: "system", text, kind: "note", createdAt: runtime.clock().toISOString() });
}

async function quietly(action) {
  try {
    await action();
  } catch (error) {
    logError("channel_hint_failed", error);
  }
}

// Passa a conversa para a equipe (a IA para de responder nela).
export function toTeam(runtime, conversation, reason, urgent = false) {
  runtime.debouncer.cancel(conversation.id);
  bumpGeneration(runtime.store, conversation.id);
  updateConversation(runtime.store, conversation.id, { owner: "human" });
  setAttention(runtime, conversation.id, reason, urgent);
  addSystemNote(runtime, conversation.id, `Passou para a equipe: ${reason}`);
  emit(runtime, conversation.id);
  return { routed: "team", reason };
}

function teamAnsweredFromPhone(runtime, conversation) {
  runtime.debouncer.cancel(conversation.id);
  bumpGeneration(runtime.store, conversation.id);
  if (conversation.owner === "ai") {
    updateConversation(runtime.store, conversation.id, { owner: "human" });
    addSystemNote(runtime, conversation.id, "A equipe respondeu pelo celular. A IA saiu desta conversa até alguém devolver.");
  }
  return { routed: "team", reason: "Resposta da equipe pelo celular." };
}

async function answerEmergency(runtime, conversation) {
  await deliver(runtime, conversation, EMERGENCY_REPLY, { author: "ai", meta: { rule: "emergência", model: null, costUsd: 0 } });
  return toTeam(runtime, conversation, "Possível emergência: a IA orientou ligar para o 192.", true);
}

async function answerInjection(runtime, conversation) {
  const { strikes, shouldPause } = registerStrike(conversation.securityStrikes ?? [], runtime.clock());
  updateConversation(runtime.store, conversation.id, { securityStrikes: strikes });
  await deliver(runtime, conversation, INJECTION_REPLY, { author: "ai", meta: { rule: "proteção", model: null, costUsd: 0 } });
  if (shouldPause) return toTeam(runtime, conversation, "Duas tentativas de mudar as regras da IA em 15 minutos.");
  return { routed: "ai", reason: "Tentativa de mudar as regras bloqueada sem chamar a IA." };
}

function triage(runtime, conversation, message) {
  const { store, config } = runtime;
  const settings = getSettings(store, config);
  bumpGeneration(store, conversation.id);
  const emergency = detectEmergency(message.text);
  if (emergency) setAttention(runtime, conversation.id, "Possível emergência na mensagem do paciente.", true);
  if (conversation.owner !== "ai") return { routed: "team", reason: "Conversa com a equipe." };
  const decision = autoReplyDecision(settings, conversation.phone);
  if (!decision.allowed) return { routed: "team", reason: decision.reason };
  if (message.kind && message.kind !== "text") return toTeam(runtime, conversation, "Paciente enviou foto, áudio ou arquivo. A IA não lê anexos nesta versão.");
  if (emergency) return answerEmergency(runtime, conversation);
  if (detectPromptInjection(message.text)) return answerInjection(runtime, conversation);
  if (!hasDailyBudget(store, settings, runtime.clock(), config.timeZone)) {
    return toTeam(runtime, conversation, "Limite diário de respostas da IA atingido. Aumente em Ajustes ou responda pela equipe.");
  }
  runtime.debouncer.schedule(conversation.id);
  return { routed: "ai", reason: "A IA vai responder depois da pausa." };
}

function toIso(timestamp, fallback) {
  const date = new Date(Number(timestamp) || fallback.getTime());
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

// message: { channel, externalId, chatId, phone, name, text, kind, timestamp, fromMe }
export async function handleInbound(runtime, message) {
  const { store } = runtime;
  const now = runtime.clock();
  if (message.fromMe && runtime.echoes.consume(message.chatId, message.text, now)) {
    markSeen(store, message.externalId);
    return { ignored: "eco do nosso próprio envio" };
  }
  if (!markSeen(store, message.externalId)) return { ignored: "duplicado" };
  const conversation = upsertConversation(store, { channel: message.channel, chatId: message.chatId, phone: message.phone, name: message.fromMe ? "" : message.name, now });
  appendMessage(store, conversation.id, {
    externalId: message.externalId, author: message.fromMe ? "team" : "patient", text: message.text ?? "",
    kind: message.kind ?? "text", status: message.fromMe ? "sent" : "received",
    createdAt: toIso(message.timestamp, now), meta: message.fromMe ? { via: "celular" } : {},
  });
  const outcome = message.fromMe ? teamAnsweredFromPhone(runtime, conversation) : await triage(runtime, conversation, message);
  emit(runtime, conversation.id);
  return outcome;
}

function readyToReply(runtime, conversationId) {
  const conversation = findConversation(runtime.store, conversationId);
  if (!conversation || conversation.owner !== "ai") return null;
  const settings = getSettings(runtime.store, runtime.config);
  if (!autoReplyDecision(settings, conversation.phone).allowed) return null;
  return { conversation, settings, generation: conversation.generation };
}

function isStale(runtime, conversationId, generation) {
  const conversation = findConversation(runtime.store, conversationId);
  return !conversation || conversation.generation !== generation || conversation.owner !== "ai";
}

export async function respond(runtime, conversationId) {
  const ready = readyToReply(runtime, conversationId);
  if (!ready) return { skipped: true };
  const { conversation, settings, generation } = ready;
  await quietly(() => runtime.channel.markReadAndTyping?.(conversation));
  const result = await thinkReply(runtime, { conversation, messages: listMessages(runtime.store, conversationId), settings, scope: "live" });
  if (isStale(runtime, conversationId, generation)) return { discarded: "chegou mensagem nova ou a equipe assumiu" };
  if (result.status === "skip") return { skipped: true };
  if (result.status !== "reply") return toTeam(runtime, conversation, result.reason);
  await runtime.sleep(typingDelayMs(result.text, runtime.config.pacing));
  if (isStale(runtime, conversationId, generation)) return { discarded: "chegou mensagem nova ou a equipe assumiu" };
  const sent = await deliver(runtime, conversation, result.text, { author: "ai", meta: replyMeta(result) });
  if (result.handoff.requested) toTeam(runtime, conversation, result.handoff.reason || "A IA pediu ajuda da equipe.", result.handoff.urgent);
  return sent;
}

export function takeOver(runtime, conversationId, note = "A equipe assumiu a conversa. A IA não responde até alguém devolver.") {
  const conversation = findConversation(runtime.store, conversationId);
  if (!conversation) return null;
  runtime.debouncer.cancel(conversationId);
  bumpGeneration(runtime.store, conversationId);
  if (conversation.owner !== "human") {
    updateConversation(runtime.store, conversationId, { owner: "human" });
    addSystemNote(runtime, conversationId, note);
  }
  emit(runtime, conversationId);
  return findConversation(runtime.store, conversationId);
}

export function handBack(runtime, conversationId) {
  const conversation = findConversation(runtime.store, conversationId);
  if (!conversation) return null;
  updateConversation(runtime.store, conversationId, { owner: "ai", attention: null, securityStrikes: [] });
  addSystemNote(runtime, conversationId, "Conversa devolvida à IA.");
  if (listMessages(runtime.store, conversationId).filter((item) => item.author !== "system").at(-1)?.author === "patient") {
    bumpGeneration(runtime.store, conversationId);
    runtime.debouncer.schedule(conversationId);
  }
  emit(runtime, conversationId);
  return findConversation(runtime.store, conversationId);
}

export async function sendManual(runtime, conversationId, text) {
  const clean = String(text ?? "").trim().slice(0, 4000);
  if (!clean) return { error: "Escreva a mensagem." };
  const conversation = findConversation(runtime.store, conversationId);
  if (!conversation) return { error: "Conversa não encontrada." };
  if (conversation.owner === "ai") takeOver(runtime, conversationId, "A equipe escreveu nesta conversa. A IA saiu até alguém devolver.");
  return deliver(runtime, findConversation(runtime.store, conversationId), clean, { author: "team", meta: { via: "painel" } });
}

export function resolveAttention(runtime, conversationId) {
  const conversation = updateConversation(runtime.store, conversationId, { attention: null });
  if (conversation) emit(runtime, conversationId);
  return conversation;
}

export function markConversationRead(runtime, conversationId) {
  const conversation = updateConversation(runtime.store, conversationId, { unread: 0 });
  if (conversation) emit(runtime, conversationId);
  return conversation;
}

// Depois de reiniciar o servidor, responde quem ficou sem resposta nos últimos 15 minutos.
export function recoverPending(runtime) {
  const limitMs = runtime.clock().getTime() - 15 * 60 * 1000;
  const pending = listConversations(runtime.store).filter((conversation) => conversation.owner === "ai"
    && conversation.lastInboundAt && Date.parse(conversation.lastInboundAt) >= limitMs
    && listMessages(runtime.store, conversation.id).filter((item) => item.author !== "system").at(-1)?.author === "patient");
  for (const conversation of pending) runtime.debouncer.schedule(conversation.id);
  return pending.length;
}
