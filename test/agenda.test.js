import assert from "node:assert/strict";
import { test } from "node:test";
import { bookAppointment, changeOwnStatus, freeSlots, patientAppointments, rescheduleAppointment } from "../src/agenda.js";
import { createClinicLoader } from "../src/clinic.js";
import { JsonStore } from "../src/store.js";
import { zonedTimeToUtc } from "../src/timezone.js";
import { NOW, testConfig } from "./helpers.js";

const TZ = "America/Sao_Paulo";
const agenda = createClinicLoader(testConfig().clinicDir)().agenda;
const maria = { id: "conv_maria", phone: "5511988887777" };
const joao = { id: "conv_joao", phone: "5521977776666" };

test("horários livres respeitam expediente, antecedência e fim de semana", () => {
  const today = freeSlots({ agenda, appointments: [], timeZone: TZ, now: NOW, fromDate: "2026-11-10", days: 1 });
  assert.equal(today[0].start.toISOString(), zonedTimeToUtc("2026-11-10", "14:00", TZ).toISOString(), "às 10h, com 2h de antecedência, o primeiro horário é 14h");
  assert.equal(today.length, 8);
  assert.ok(today.every((slot) => slot.start.getTime() >= NOW.getTime() + 2 * 3_600_000));
  const saturday = freeSlots({ agenda, appointments: [], timeZone: TZ, now: NOW, fromDate: "2026-11-14", days: 2 });
  assert.equal(saturday.length, 0, "sábado e domingo fechados");
  const friday = freeSlots({ agenda, appointments: [], timeZone: TZ, now: NOW, fromDate: "2026-11-13", days: 1 });
  assert.equal(friday.length, 8, "sexta: 8h às 12h, consultas de 30 minutos");
  const mornings = freeSlots({ agenda, appointments: [], timeZone: TZ, now: NOW, fromDate: "2026-11-11", days: 1, period: "manha" });
  assert.equal(mornings.length, 8);
});

test("agendar ocupa o horário e só o próprio paciente remarca ou cancela", () => {
  const store = new JsonStore(null);
  const common = { scope: "live", agenda, timeZone: TZ, now: NOW };
  const booked = bookAppointment(store, { ...common, conversation: maria, startLocal: "2026-11-11T09:00", patientName: "Maria Lima", reason: "Primeira consulta" });
  assert.equal(booked.ok, true);
  assert.equal(booked.quando, "quarta-feira, 11/11 às 9h");
  const twice = bookAppointment(store, { ...common, conversation: joao, startLocal: "2026-11-11T09:00", patientName: "João", reason: "" });
  assert.equal(twice.ok, false, "não marca duas pessoas no mesmo horário");
  const foreign = changeOwnStatus(store, { ...common, conversation: joao, appointmentId: booked.consulta_id, status: "cancelled" });
  assert.equal(foreign.ok, false, "João não cancela a consulta da Maria");
  const moved = rescheduleAppointment(store, { ...common, conversation: { id: "outra", phone: "551188887777" }, appointmentId: booked.consulta_id, newStartLocal: "2026-11-11T09:30" });
  assert.equal(moved.ok, true, "mesmo telefone sem o 9º dígito é a mesma paciente");
  assert.equal(patientAppointments(store.state, { scope: "live", conversation: maria, now: NOW }).length, 1);
  const invalid = bookAppointment(store, { ...common, conversation: joao, startLocal: "amanhã 9h", patientName: "João", reason: "" });
  assert.equal(invalid.ok, false);
});

test("o laboratório usa uma agenda separada", () => {
  const store = new JsonStore(null);
  const lab = bookAppointment(store, { scope: "lab", agenda, timeZone: TZ, now: NOW, conversation: { id: "lab_1", phone: "550000000000" }, startLocal: "2026-11-12T10:00", patientName: "Teste", reason: "" });
  assert.equal(lab.ok, true);
  assert.equal(store.state.appointments.length, 0);
  assert.equal(store.state.lab.appointments.length, 1);
});
