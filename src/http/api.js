// Rotas do painel (todas exigem a senha do painel).
import { readFileSync } from "node:fs";
import { setAppointmentStatus, STATUS_LABELS } from "../agenda.js";
import { handBack, handleInbound, markConversationRead, resolveAttention, sendManual, takeOver } from "../assistant.js";
import { describeAiError } from "../brain.js";
import { MODEL_OPTIONS, MODEL_PRICES, usageToday } from "../budget.js";
import { findConversation, listConversations, listMessages } from "../conversations.js";
import { labReply, resetLab } from "../lab.js";
import { createCorrectionLesson, decideLesson, proposeLessons } from "../learning.js";
import { MODE_LABELS } from "../modes.js";
import { maskPhone, samePhone } from "../phone.js";
import { getSettings, updateSettings, ValidationError } from "../settings.js";
import { formatForPatient } from "../timezone.js";
import { fail, ok, route } from "./router.js";

function summary(conversation, settings) {
  return {
    id: conversation.id, name: conversation.name || "Sem nome", phone: maskPhone(conversation.phone),
    owner: conversation.owner, attention: conversation.attention, unread: conversation.unread,
    preview: conversation.preview, lastMessageAt: conversation.lastMessageAt,
    isTestNumber: settings.testNumbers.some((number) => samePhone(number, conversation.phone)),
  };
}

function snapshot(runtime) {
  const settings = getSettings(runtime.store, runtime.config);
  return {
    channel: { name: runtime.channel.name, label: runtime.channel.label },
    settings, modes: MODE_LABELS,
    models: MODEL_OPTIONS.map((option) => ({ ...option, price: MODEL_PRICES[option.id] })),
    usage: usageToday(runtime.store, runtime.clock(), runtime.config.timeZone),
    demo: runtime.store.state.demo === true,
    conversations: listConversations(runtime.store).map((item) => summary(item, settings)),
  };
}

function conversationDetail(runtime, conversationId) {
  const conversation = findConversation(runtime.store, conversationId);
  if (!conversation) return fail(404, "Conversa não encontrada.");
  const settings = getSettings(runtime.store, runtime.config);
  return ok({ conversation: summary(conversation, settings), messages: listMessages(runtime.store, conversationId) });
}

function appointmentsView(runtime) {
  const now = runtime.clock().getTime();
  const conversations = runtime.store.state.conversations;
  const items = runtime.store.state.appointments
    .filter((item) => Date.parse(item.start) >= now - 10 * 86_400_000)
    .sort((first, second) => first.start.localeCompare(second.start))
    .map((item) => ({
      ...item, phone: maskPhone(item.phone), statusLabel: STATUS_LABELS[item.status],
      when: formatForPatient(new Date(item.start), runtime.config.timeZone),
      conversationName: conversations[item.conversationId]?.name ?? "",
    }));
  return ok({ appointments: items });
}

async function reviewLessons(runtime, body) {
  try {
    return ok(await proposeLessons(runtime, { days: Math.min(30, Math.max(1, Number(body.days) || 1)) }));
  } catch (error) {
    return fail(502, describeAiError(error));
  }
}

function labView(runtime) {
  const scenarios = JSON.parse(readFileSync(runtime.config.labFile, "utf8"));
  const conversations = Object.values(runtime.store.state.lab.conversations).sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  return ok({ scenarios, conversations });
}

async function simulatorMessage(runtime, body) {
  if (runtime.channel.name !== "simulado") return fail(400, "O simulador só funciona com WHATSAPP_CHANNEL=simulado.");
  const phone = String(body.phone ?? "").replace(/\D/g, "");
  if (phone.length < 10 || !String(body.text ?? "").trim()) return fail(400, "Informe telefone (com DDI e DDD) e mensagem.");
  const outcome = await handleInbound(runtime, {
    channel: "simulado", externalId: `sim_in_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    chatId: `${phone}@c.us`, phone, name: String(body.name ?? "").slice(0, 80), text: String(body.text).slice(0, 2000),
    kind: "text", timestamp: Date.now(), fromMe: false,
  });
  return ok(outcome);
}

function settingsUpdate(runtime, body) {
  try {
    return ok(updateSettings(runtime.store, runtime.config, body));
  } catch (error) {
    if (error instanceof ValidationError) return fail(400, error.message);
    throw error;
  }
}

const found = (value, message = "Conversa não encontrada.") => (value ? ok(value) : fail(404, message));
const fromResult = (result) => (result?.error ? fail(400, result.error) : ok(result));

export function apiRoutes(runtime) {
  return [
    route("GET", "/api/state", () => ok(snapshot(runtime))),
    route("GET", "/api/conversations/:id", ({ params }) => conversationDetail(runtime, params[0])),
    route("POST", "/api/conversations/:id/messages", async ({ params, body }) => fromResult(await sendManual(runtime, params[0], body.text))),
    route("POST", "/api/conversations/:id/take-over", ({ params }) => found(takeOver(runtime, params[0]))),
    route("POST", "/api/conversations/:id/hand-back", ({ params }) => found(handBack(runtime, params[0]))),
    route("POST", "/api/conversations/:id/resolve", ({ params }) => found(resolveAttention(runtime, params[0]))),
    route("POST", "/api/conversations/:id/read", ({ params }) => found(markConversationRead(runtime, params[0]))),
    route("POST", "/api/conversations/:id/messages/:messageId/correction", ({ params, body }) => fromResult(createCorrectionLesson(runtime.store, {
      conversationId: params[0], messageId: params[1], idealAnswer: body.idealAnswer, now: runtime.clock(),
    }))),
    route("PUT", "/api/settings", ({ body }) => settingsUpdate(runtime, body)),
    route("GET", "/api/appointments", () => appointmentsView(runtime)),
    route("POST", "/api/appointments/:id/status", ({ params, body }) => found(setAppointmentStatus(runtime.store, params[0], body.status, runtime.clock()), "Consulta não encontrada.")),
    route("GET", "/api/lab", () => labView(runtime)),
    route("POST", "/api/lab/messages", async ({ body }) => fromResult(await labReply(runtime, { labId: body.labId, text: body.text }))),
    route("POST", "/api/lab/reset", () => ok(resetLab(runtime) ?? { reset: true })),
    route("GET", "/api/lessons", () => ok({ lessons: runtime.store.state.lessons })),
    route("POST", "/api/lessons/review", ({ body }) => reviewLessons(runtime, body)),
    route("POST", "/api/lessons/:id/decision", ({ params, body }) => fromResult(decideLesson(runtime.store, { lessonId: params[0], approve: body.approve === true, text: body.text, now: runtime.clock() }))),
    route("POST", "/api/simulator/messages", ({ body }) => simulatorMessage(runtime, body)),
  ];
}
