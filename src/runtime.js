// Monta todas as peças. Os testes trocam canal, IA e relógio por versões falsas.
import { EventEmitter } from "node:events";
import path from "node:path";
import { respond } from "./assistant.js";
import { createAnthropicClient } from "./brain.js";
import { createChannel } from "./channels/index.js";
import { createClinicLoader } from "./clinic.js";
import { createEchoTracker } from "./delivery.js";
import { logError } from "./log.js";
import { createDebouncer, sleep } from "./pacing.js";
import { JsonStore } from "./store.js";

export function createRuntime(config, overrides = {}) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const runtime = {
    config,
    bus,
    store: overrides.store ?? new JsonStore(path.join(config.dataDir, "db.json")),
    channel: overrides.channel ?? createChannel(config),
    client: overrides.client ?? createAnthropicClient(),
    loadClinic: overrides.loadClinic ?? createClinicLoader(config.clinicDir),
    clock: overrides.clock ?? (() => new Date()),
    sleep: overrides.sleep ?? sleep,
    echoes: createEchoTracker(),
  };
  runtime.debouncer = createDebouncer(config.pacing.inboundWaitMs, (conversationId) => {
    respond(runtime, conversationId).catch((error) => logError("reply_failed", error, { conversationId }));
  });
  return runtime;
}
