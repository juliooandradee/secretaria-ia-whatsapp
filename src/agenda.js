// Agenda própria, simples, configurada em clinica/agenda.json.
// O laboratório grava numa lista separada, mas enxerga a agenda real para oferecer horários reais.
import { newId } from "./ids.js";
import { samePhone } from "./phone.js";
import { addDaysToLocalDate, formatForPatient, localStamp, parseLocalStamp, weekdayKey, zonedParts, zonedTimeToUtc } from "./timezone.js";

export const STATUS_LABELS = { scheduled: "agendada", confirmed: "confirmada", cancelled: "cancelada", done: "realizada", no_show: "faltou" };
const ACTIVE_STATUSES = new Set(["scheduled", "confirmed"]);
const PANEL_STATUSES = new Set(["done", "no_show", "cancelled", "confirmed", "scheduled"]);

export function appointmentLists(state, scope) {
  if (scope === "lab") return { readable: [...state.appointments, ...state.lab.appointments], writable: state.lab.appointments };
  return { readable: state.appointments, writable: state.appointments };
}

function daySlots(agenda, day, timeZone) {
  if ((agenda.bloqueios ?? []).some((block) => block.data === day)) return [];
  const durationMs = agenda.duracaoConsultaMinutos * 60_000;
  const intervals = agenda.horarios?.[weekdayKey(day)] ?? [];
  return intervals.flatMap(([open, close]) => {
    const slots = [];
    const closeMs = zonedTimeToUtc(day, close, timeZone).getTime();
    for (let startMs = zonedTimeToUtc(day, open, timeZone).getTime(); startMs + durationMs <= closeMs; startMs += durationMs) {
      slots.push({ start: new Date(startMs), end: new Date(startMs + durationMs) });
    }
    return slots;
  });
}

function overlaps(slot, appointments) {
  return appointments.some((item) => ACTIVE_STATUSES.has(item.status)
    && Date.parse(item.start) < slot.end.getTime()
    && Date.parse(item.end) > slot.start.getTime());
}

function matchesPeriod(slot, period, timeZone) {
  const hour = zonedParts(slot.start, timeZone).hour;
  if (period === "manha") return hour < 12;
  if (period === "tarde") return hour >= 12;
  return true;
}

export function freeSlots({ agenda, appointments, timeZone, now, fromDate, days, period = "qualquer" }) {
  const earliestMs = now.getTime() + (agenda.antecedenciaMinimaHoras ?? 0) * 3_600_000;
  const result = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDaysToLocalDate(fromDate, offset);
    for (const slot of daySlots(agenda, day, timeZone)) {
      const usable = slot.start.getTime() >= earliestMs && matchesPeriod(slot, period, timeZone) && !overlaps(slot, appointments);
      if (usable) result.push(slot);
    }
  }
  return result;
}

export function describeSlot(slot, timeZone) {
  return { inicio: localStamp(slot.start, timeZone), quando: formatForPatient(slot.start, timeZone) };
}

function findFreeSlot({ agenda, appointments, timeZone, now, startLocal }) {
  const start = parseLocalStamp(startLocal, timeZone);
  if (!start) return { error: "Horário em formato inválido. Use AAAA-MM-DDTHH:MM." };
  const day = localStamp(start, timeZone).slice(0, 10);
  const slot = freeSlots({ agenda, appointments, timeZone, now, fromDate: day, days: 1 })
    .find((item) => item.start.getTime() === start.getTime());
  return slot ? { slot } : { error: "Esse horário não está livre. Consulte ver_horarios_livres de novo." };
}

function belongsTo(appointment, conversation) {
  if (appointment.conversationId === conversation.id) return true;
  return Boolean(conversation.phone) && samePhone(appointment.phone, conversation.phone);
}

export function bookAppointment(store, { scope, agenda, timeZone, now, conversation, startLocal, patientName, reason }) {
  return store.update((state) => {
    const lists = appointmentLists(state, scope);
    const found = findFreeSlot({ agenda, appointments: lists.readable, timeZone, now, startLocal });
    if (found.error) return { ok: false, erro: found.error };
    const appointment = {
      id: newId("c"), conversationId: conversation.id, phone: conversation.phone,
      patientName: String(patientName ?? "").trim().slice(0, 120), reason: String(reason ?? "").trim().slice(0, 200),
      start: found.slot.start.toISOString(), end: found.slot.end.toISOString(), status: "scheduled",
      createdAt: now.toISOString(), confirmationSentAt: null, followUpSentAt: null,
    };
    lists.writable.push(appointment);
    return { ok: true, consulta_id: appointment.id, quando: formatForPatient(found.slot.start, timeZone) };
  });
}

export function patientAppointments(state, { scope, conversation, now }) {
  const { writable } = appointmentLists(state, scope);
  return writable
    .filter((item) => belongsTo(item, conversation) && Date.parse(item.end) >= now.getTime() - 86_400_000)
    .sort((first, second) => first.start.localeCompare(second.start));
}

function ownedActiveAppointment(state, scope, conversation, appointmentId) {
  return appointmentLists(state, scope).writable
    .find((item) => item.id === appointmentId && belongsTo(item, conversation) && ACTIVE_STATUSES.has(item.status)) ?? null;
}

export function rescheduleAppointment(store, { scope, agenda, timeZone, now, conversation, appointmentId, newStartLocal }) {
  return store.update((state) => {
    const appointment = ownedActiveAppointment(state, scope, conversation, appointmentId);
    if (!appointment) return { ok: false, erro: "Consulta não encontrada para este paciente." };
    const others = appointmentLists(state, scope).readable.filter((item) => item.id !== appointment.id);
    const found = findFreeSlot({ agenda, appointments: others, timeZone, now, startLocal: newStartLocal });
    if (found.error) return { ok: false, erro: found.error };
    Object.assign(appointment, {
      start: found.slot.start.toISOString(), end: found.slot.end.toISOString(),
      status: "scheduled", confirmationSentAt: null, rescheduledAt: now.toISOString(),
    });
    return { ok: true, consulta_id: appointment.id, quando: formatForPatient(found.slot.start, timeZone) };
  });
}

export function changeOwnStatus(store, { scope, timeZone, now, conversation, appointmentId, status }) {
  return store.update((state) => {
    const appointment = ownedActiveAppointment(state, scope, conversation, appointmentId);
    if (!appointment) return { ok: false, erro: "Consulta não encontrada para este paciente." };
    Object.assign(appointment, { status, [`${status}At`]: now.toISOString() });
    return { ok: true, consulta_id: appointment.id, situacao: STATUS_LABELS[status], quando: formatForPatient(new Date(appointment.start), timeZone) };
  });
}

// Usado pelo painel (equipe): marcar realizada, faltou, cancelada...
export function setAppointmentStatus(store, appointmentId, status, now) {
  if (!PANEL_STATUSES.has(status)) return null;
  return store.update((state) => {
    const appointment = state.appointments.find((item) => item.id === appointmentId);
    if (appointment) Object.assign(appointment, { status, [`${status}At`]: now.toISOString() });
    return appointment ?? null;
  });
}
