// Ferramentas que a IA pode usar. A identidade do paciente vem SEMPRE do servidor
// (a conversa), nunca de um telefone digitado na mensagem.
import { bookAppointment, changeOwnStatus, describeSlot, freeSlots, patientAppointments, rescheduleAppointment, appointmentLists, STATUS_LABELS } from "./agenda.js";
import { formatForPatient, isLocalDate, localStamp } from "./timezone.js";

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});

export const TOOL_DEFINITIONS = [
  {
    name: "ver_horarios_livres",
    description: "Lista horários livres na agenda da clínica. Use sempre antes de oferecer horários ao paciente.",
    strict: true,
    input_schema: objectSchema({
      a_partir_de: { type: "string", description: "Primeiro dia a consultar, no formato AAAA-MM-DD." },
      dias: { type: "integer", description: "Quantos dias olhar a partir dessa data (1 a 14)." },
      periodo: { type: "string", enum: ["manha", "tarde", "qualquer"], description: "Período preferido pelo paciente." },
    }),
  },
  {
    name: "agendar_consulta",
    description: "Marca a consulta num horário livre. Antes, confirme com o paciente o nome completo e o horário.",
    strict: true,
    input_schema: objectSchema({
      inicio: { type: "string", description: "Horário escolhido exatamente como veio de ver_horarios_livres (AAAA-MM-DDTHH:MM)." },
      nome_paciente: { type: "string", description: "Nome completo do paciente." },
      motivo: { type: "string", description: "Motivo em poucas palavras (ex.: primeira consulta, retorno). Sem detalhes clínicos." },
    }),
  },
  {
    name: "consultas_do_paciente",
    description: "Mostra as consultas futuras deste paciente (o da conversa atual).",
    strict: true,
    input_schema: objectSchema({}),
  },
  {
    name: "remarcar_consulta",
    description: "Muda uma consulta deste paciente para outro horário livre.",
    strict: true,
    input_schema: objectSchema({
      consulta_id: { type: "string", description: "Identificador da consulta (ex.: c_ab12cd34ef)." },
      novo_inicio: { type: "string", description: "Novo horário, vindo de ver_horarios_livres (AAAA-MM-DDTHH:MM)." },
    }),
  },
  {
    name: "cancelar_consulta",
    description: "Cancela uma consulta deste paciente. Confirme com ele antes.",
    strict: true,
    input_schema: objectSchema({ consulta_id: { type: "string", description: "Identificador da consulta." } }),
  },
  {
    name: "confirmar_presenca",
    description: "Registra que o paciente confirmou que vai à consulta.",
    strict: true,
    input_schema: objectSchema({ consulta_id: { type: "string", description: "Identificador da consulta." } }),
  },
  {
    name: "chamar_humano",
    description: "Passa a conversa para a equipe da clínica. Use para pedidos de pessoa, reclamações, pagamentos, dúvidas fora da base e qualquer pergunta clínica.",
    strict: true,
    input_schema: objectSchema({
      motivo: { type: "string", description: "Motivo curto para a equipe entender o caso." },
      urgente: { type: "boolean", description: "true se parecer urgente." },
    }),
  },
];

const asResult = (value) => JSON.stringify(value);

function listFreeSlots(context, input) {
  if (!isLocalDate(input.a_partir_de)) return { ok: false, erro: "Data inválida. Use AAAA-MM-DD." };
  const today = localStamp(context.now(), context.timeZone).slice(0, 10);
  const fromDate = input.a_partir_de < today ? today : input.a_partir_de;
  const days = Math.min(14, Math.max(1, Number(input.dias) || 1));
  const appointments = appointmentLists(context.store.state, context.scope).readable;
  const slots = freeSlots({ agenda: context.clinic().agenda, appointments, timeZone: context.timeZone, now: context.now(), fromDate, days, period: input.periodo });
  const horarios = slots.slice(0, 12).map((slot) => describeSlot(slot, context.timeZone));
  return horarios.length ? { ok: true, horarios } : { ok: true, horarios: [], aviso: "Sem horários livres nesse período. Sugira outros dias." };
}

function listOwnAppointments(context) {
  const items = patientAppointments(context.store.state, { scope: context.scope, conversation: context.conversation, now: context.now() });
  return {
    ok: true,
    consultas: items.map((item) => ({ consulta_id: item.id, quando: formatForPatient(new Date(item.start), context.timeZone), situacao: STATUS_LABELS[item.status] })),
  };
}

const HANDLERS = {
  ver_horarios_livres: listFreeSlots,
  consultas_do_paciente: listOwnAppointments,
  agendar_consulta: (context, input) => bookAppointment(context.store, {
    ...common(context), startLocal: input.inicio, patientName: input.nome_paciente, reason: input.motivo,
  }),
  remarcar_consulta: (context, input) => rescheduleAppointment(context.store, {
    ...common(context), appointmentId: input.consulta_id, newStartLocal: input.novo_inicio,
  }),
  cancelar_consulta: (context, input) => changeOwnStatus(context.store, { ...common(context), appointmentId: input.consulta_id, status: "cancelled" }),
  confirmar_presenca: (context, input) => changeOwnStatus(context.store, { ...common(context), appointmentId: input.consulta_id, status: "confirmed" }),
  chamar_humano: (context, input) => {
    context.onHandoff({ reason: String(input.motivo ?? "").slice(0, 300), urgent: input.urgente === true });
    return { ok: true, mensagem: "Equipe avisada. Diga ao paciente, com gentileza, que alguém da equipe vai responder em breve." };
  },
};

function common(context) {
  return { scope: context.scope, agenda: context.clinic().agenda, timeZone: context.timeZone, now: context.now(), conversation: context.conversation };
}

// context: { store, clinic(), timeZone, now(), conversation, scope: "live" | "lab", onHandoff(handoff) }
export function createToolRunner(context) {
  return async function runTool(name, input) {
    const handler = HANDLERS[name];
    if (!handler) return asResult({ ok: false, erro: `Ferramenta desconhecida: ${name}` });
    return asResult(handler(context, input ?? {}));
  };
}
