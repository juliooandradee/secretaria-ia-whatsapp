// Laboratório: a equipe conversa com a IA como se fosse um paciente.
// Usa a IA de verdade (conta no limite diário), mas nada sai para o WhatsApp
// e as consultas marcadas aqui ficam numa agenda de teste separada.
import { hasDailyBudget } from "./budget.js";
import { detectEmergency, detectPromptInjection, EMERGENCY_REPLY, INJECTION_REPLY } from "./guard.js";
import { newId } from "./ids.js";
import { getSettings } from "./settings.js";
import { replyMeta, thinkReply } from "./think.js";

const LAB_PHONE = "550000000000";

export function ensureLabConversation(runtime, labId) {
  return runtime.store.update((state) => {
    const id = labId && state.lab.conversations[labId] ? labId : newId("lab");
    state.lab.conversations[id] ??= { id, name: "Paciente de teste", phone: LAB_PHONE, owner: "ai", messages: [], createdAt: runtime.clock().toISOString() };
    return state.lab.conversations[id];
  });
}

function appendLabMessage(runtime, conversationId, message) {
  return runtime.store.update((state) => {
    const stored = { id: newId("m"), createdAt: runtime.clock().toISOString(), meta: {}, ...message };
    state.lab.conversations[conversationId].messages.push(stored);
    return stored;
  });
}

function quickRule(text) {
  if (detectEmergency(text)) return { text: EMERGENCY_REPLY, rule: "emergência", note: "No WhatsApp, a conversa iria para a equipe com prioridade." };
  if (detectPromptInjection(text)) return { text: INJECTION_REPLY, rule: "proteção", note: "Bloqueado antes de chamar a IA (zero tokens)." };
  return null;
}

async function aiTurn(runtime, conversation) {
  const settings = getSettings(runtime.store, runtime.config);
  if (!hasDailyBudget(runtime.store, settings, runtime.clock(), runtime.config.timeZone)) {
    appendLabMessage(runtime, conversation.id, { author: "system", text: "Limite diário de respostas da IA atingido." });
    return;
  }
  const result = await thinkReply(runtime, { conversation, messages: conversation.messages, settings, scope: "lab" });
  if (result.status === "reply") appendLabMessage(runtime, conversation.id, { author: "ai", text: result.text, meta: replyMeta(result) });
  else appendLabMessage(runtime, conversation.id, { author: "system", text: `Sem resposta ao paciente. No WhatsApp, iria para a equipe: ${result.reason}`, meta: replyMeta(result) });
  if (result.handoff?.requested) {
    appendLabMessage(runtime, conversation.id, { author: "system", text: `A IA chamou a equipe: ${result.handoff.reason || "sem motivo informado"}${result.handoff.urgent ? " (urgente)" : ""}.` });
  }
}

export async function labReply(runtime, { labId, text }) {
  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return { error: "Escreva a mensagem do paciente." };
  const conversation = ensureLabConversation(runtime, labId);
  appendLabMessage(runtime, conversation.id, { author: "patient", text: clean });
  const rule = quickRule(clean);
  if (rule) {
    appendLabMessage(runtime, conversation.id, { author: "ai", text: rule.text, meta: { rule: rule.rule, model: null, costUsd: 0, tools: [] } });
    appendLabMessage(runtime, conversation.id, { author: "system", text: rule.note });
  } else {
    await aiTurn(runtime, conversation);
  }
  runtime.bus.emit("lab", { labId: conversation.id });
  return runtime.store.state.lab.conversations[conversation.id];
}

export function resetLab(runtime) {
  runtime.store.update((state) => {
    state.lab = { conversations: {}, appointments: [] };
  });
}
