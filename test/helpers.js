// Peças falsas para os testes: nenhuma chamada real ao Claude ou ao WhatsApp.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClinicLoader } from "../src/clinic.js";
import { loadConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { JsonStore } from "../src/store.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Terça-feira, 10/11/2026, 10h em São Paulo.
export const NOW = new Date("2026-11-10T13:00:00Z");

export function testConfig(env = {}) {
  return loadConfig({
    PANEL_PASSWORD: "senha-de-teste-bem-longa", CLINIC_DIR: path.join(root, "clinica"), LAB_FILE: path.join(root, "lab", "scenarios.json"),
    INBOUND_WAIT_SECONDS: "0", TYPING_MS_PER_CHAR: "0", TYPING_MAX_SECONDS: "0", ...env,
  });
}

const usage = { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };

export function textResponse(text, extra = {}) {
  return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }], usage, ...extra };
}

export function toolResponse(name, input, id = `toolu_${name}`) {
  return { model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "tool_use", id, name, input }], usage };
}

export function fakeClient(responses = []) {
  const requests = [];
  const create = async (request) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("Fim das respostas falsas.");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : next;
  };
  return { requests, responses, messages: { create }, beta: { messages: { create } } };
}

export function fakeChannel(name = "simulado") {
  const sent = [];
  let counter = 0;
  return {
    name, label: "Canal de teste", sent, failNext: null,
    async sendText(conversation, text) {
      if (this.failNext) {
        const error = this.failNext;
        this.failNext = null;
        throw error;
      }
      counter += 1;
      sent.push({ chatId: conversation.chatId, text });
      return { externalId: `out_${counter}` };
    },
    async sendTemplate(conversation, template, parameters) {
      counter += 1;
      sent.push({ chatId: conversation.chatId, template, parameters });
      return { externalId: `out_${counter}` };
    },
    async markReadAndTyping() {},
    async status() {
      return { connected: true, detail: "teste" };
    },
  };
}

export function testRuntime({ responses = [], settings = {}, env = {}, channel = fakeChannel(), clock = () => NOW } = {}) {
  const config = testConfig(env);
  const store = new JsonStore(null);
  store.update((state) => { state.settings = { mode: "live", ...settings }; });
  const client = fakeClient(responses);
  const runtime = createRuntime(config, { store, channel, client, clock, sleep: async () => {}, loadClinic: createClinicLoader(config.clinicDir) });
  return { runtime, store, client, channel, config };
}

export function inbound(text, overrides = {}) {
  return {
    channel: "simulado", externalId: `in_${Math.random().toString(16).slice(2)}`, chatId: "5511988887777@c.us",
    phone: "5511988887777", name: "Maria Lima", text, kind: "text", timestamp: NOW.getTime(), fromMe: false, ...overrides,
  };
}
