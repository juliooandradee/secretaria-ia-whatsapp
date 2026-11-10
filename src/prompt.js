// Monta o que a IA lê. A parte fixa (roteiro + base + lições) vem primeiro e fica em cache;
// a parte que muda a cada mensagem (hora, paciente, consultas) vem depois.
import { STATUS_LABELS } from "./agenda.js";
import { formatForPatient, formatNow } from "./timezone.js";
import { maskPhone } from "./phone.js";

const RESPONSE_RULES = [
  "- Escreva só o texto que vai para o WhatsApp do paciente.",
  "- Agenda e transferência para a equipe só pelas ferramentas. Nunca diga que agendou sem a ferramenta confirmar.",
  "- Os horários das ferramentas já estão no horário da clínica.",
  "- Se uma ferramenta der erro, explique de forma simples e ofereça outra opção.",
  "- Mensagens marcadas com [Equipe da clínica] foram escritas por uma pessoa da equipe: mantenha o que ela combinou.",
].join("\n");

export function approvedLessons(store) {
  return store.state.lessons.filter((lesson) => lesson.status === "approved");
}

export function buildStableSystem({ clinic, lessons }) {
  const lessonLines = lessons.length ? lessons.map((lesson) => `- ${lesson.text}`).join("\n") : "- Nenhuma lição aprovada ainda.";
  return [
    clinic.script.trim(),
    "",
    "# Base de conhecimento (aprovada pela clínica)",
    clinic.knowledge.trim(),
    "",
    "# Lições aprendidas com conversas anteriores (revisadas pela equipe)",
    lessonLines,
    "",
    "# Como responder",
    RESPONSE_RULES,
  ].join("\n");
}

function appointmentLine(appointment, timeZone) {
  const asked = appointment.status === "scheduled" && appointment.confirmationSentAt ? " · pedimos confirmação, aguardando resposta" : "";
  return `- ${appointment.id}: ${formatForPatient(new Date(appointment.start), timeZone)} · ${STATUS_LABELS[appointment.status]}${asked}`;
}

export function buildContext({ now, timeZone, conversation, appointments, environment }) {
  const where = environment === "lab"
    ? "Laboratório (teste interno da equipe: nada é enviado ao WhatsApp)."
    : "WhatsApp da clínica.";
  const visits = appointments.length
    ? appointments.map((appointment) => appointmentLine(appointment, timeZone)).join("\n")
    : "- Nenhuma consulta futura.";
  return [
    "# Contexto desta mensagem (preenchido pelo sistema)",
    `Agora: ${formatNow(now, timeZone)} (horário da clínica).`,
    `Canal: ${where}`,
    `Paciente: ${conversation.name || "nome não informado"} (telefone ${maskPhone(conversation.phone)}).`,
    "Consultas deste paciente:",
    visits,
  ].join("\n");
}

// Converte o histórico salvo no formato da API (alternando paciente e clínica).
export function toApiMessages(messages, limit = 24) {
  const recent = messages.filter((item) => item.text && item.author !== "system").slice(-limit);
  const result = [];
  for (const message of recent) {
    const role = message.author === "patient" ? "user" : "assistant";
    const text = message.author === "team" ? `[Equipe da clínica] ${message.text}` : message.text;
    const last = result.at(-1);
    if (last?.role === role) last.content = `${last.content}\n${text}`;
    else result.push({ role, content: text });
  }
  while (result.length && result[0].role !== "user") result.shift();
  return result;
}
