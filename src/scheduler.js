// Ações automáticas: confirmar consulta antes do dia e perguntar como o paciente está depois.
// Cada mensagem é marcada como enviada ANTES do envio: nunca sai duas vezes.
import { automationText } from "./clinic.js";
import { findConversation } from "./conversations.js";
import { deliver } from "./delivery.js";
import { logError } from "./log.js";
import { autoReplyDecision } from "./modes.js";
import { getSettings } from "./settings.js";
import { formatForPatient, zonedParts } from "./timezone.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const KINDS = {
  confirmation: { field: "confirmationSentAt", messageKey: "confirmacao", fallback: "Olá, {nome}! Confirmando sua consulta {quando}. Você confirma?" },
  followUp: { field: "followUpSentAt", messageKey: "retorno", fallback: "Oi, {nome}! Como você está depois da consulta?" },
};

export function isQuietTime(now, config) {
  const quiet = config.automations.quietHours;
  if (!quiet) return false;
  const { hour } = zonedParts(now, config.timeZone);
  return quiet.start > quiet.end ? hour >= quiet.start || hour < quiet.end : hour >= quiet.start && hour < quiet.end;
}

export function dueConfirmations(runtime, now) {
  const windowMs = runtime.config.automations.confirmationHoursBefore * HOUR;
  return runtime.store.state.appointments.filter((item) => {
    const untilStart = Date.parse(item.start) - now.getTime();
    return item.status === "scheduled" && !item.confirmationSentAt && untilStart <= windowMs && untilStart > HOUR;
  });
}

export function dueFollowUps(runtime, now) {
  const delayMs = runtime.config.automations.followUpDaysAfter * DAY;
  return runtime.store.state.appointments.filter((item) => {
    const sinceStart = now.getTime() - Date.parse(item.start);
    return item.status === "done" && !item.followUpSentAt && sinceStart >= delayMs && sinceStart < delayMs + 3 * DAY;
  });
}

function firstName(name) {
  return String(name ?? "").trim().split(/\s+/)[0] || "tudo bem";
}

function messageFor(runtime, appointment, conversation, kind) {
  const clinic = runtime.loadClinic();
  const values = {
    nome: firstName(appointment.patientName || conversation.name),
    quando: formatForPatient(new Date(appointment.start), runtime.config.timeZone),
    profissional: clinic.agenda.profissional ?? "equipe",
  };
  const text = automationText(clinic.agenda.mensagens?.[KINDS[kind].messageKey] ?? KINDS[kind].fallback, values);
  if (runtime.channel.name !== "oficial") return { text, template: null };
  const parameters = kind === "confirmation" ? [values.nome, values.quando, values.profissional] : [values.nome, values.profissional];
  return { text, template: { name: runtime.config.meta.templates[kind], parameters } };
}

async function sendAutomation(runtime, appointment, kind) {
  const conversation = findConversation(runtime.store, appointment.conversationId);
  if (!conversation) return { appointmentId: appointment.id, kind, skipped: "sem conversa no WhatsApp" };
  if (kind === "followUp" && conversation.owner !== "ai") return { appointmentId: appointment.id, kind, skipped: "conversa com a equipe" };
  const settings = getSettings(runtime.store, runtime.config);
  if (!autoReplyDecision(settings, conversation.phone).allowed) return { appointmentId: appointment.id, kind, skipped: "modo atual não permite" };
  const { text, template } = messageFor(runtime, appointment, conversation, kind);
  runtime.store.update(() => {
    appointment[KINDS[kind].field] = runtime.clock().toISOString();
  });
  const result = await deliver(runtime, conversation, text, { author: "automation", meta: { automation: kind, appointmentId: appointment.id, template: template?.name ?? null }, template });
  return { appointmentId: appointment.id, kind, ...result };
}

export async function runAutomations(runtime) {
  const now = runtime.clock();
  const settings = getSettings(runtime.store, runtime.config);
  if (settings.mode === "lab" || settings.mode === "paused") return { skipped: "modo", sent: [] };
  if (isQuietTime(now, runtime.config)) return { skipped: "horário de silêncio", sent: [] };
  const sent = [];
  if (settings.confirmationsEnabled) {
    for (const appointment of dueConfirmations(runtime, now)) sent.push(await sendAutomation(runtime, appointment, "confirmation"));
  }
  if (settings.followUpsEnabled) {
    for (const appointment of dueFollowUps(runtime, now)) sent.push(await sendAutomation(runtime, appointment, "followUp"));
  }
  return { sent };
}

export function startScheduler(runtime, intervalMs = 60_000) {
  const timer = setInterval(() => {
    runAutomations(runtime).catch((error) => logError("automations_failed", error));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
