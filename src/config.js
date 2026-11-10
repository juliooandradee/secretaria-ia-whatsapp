import path from "node:path";
import { MODEL_PRICES } from "./budget.js";

const CHANNELS = ["simulado", "oficial", "waha"];
const EFFORTS = ["low", "medium", "high"];

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseQuietHours(value) {
  const match = String(value ?? "").match(/^(\d{1,2})-(\d{1,2})$/);
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}

function metaConfig(env) {
  return {
    accessToken: env.META_ACCESS_TOKEN || "",
    phoneNumberId: env.META_PHONE_NUMBER_ID || "",
    appSecret: env.META_APP_SECRET || "",
    verifyToken: env.META_VERIFY_TOKEN || "",
    graphVersion: env.META_GRAPH_VERSION || "v26.0",
    templates: {
      confirmation: env.META_TEMPLATE_CONFIRMATION || "confirmacao_consulta",
      followUp: env.META_TEMPLATE_FOLLOWUP || "retorno_paciente",
      language: env.META_TEMPLATE_LANGUAGE || "pt_BR",
    },
  };
}

function wahaConfig(env) {
  return {
    url: (env.WAHA_URL || "http://localhost:3008").replace(/\/+$/, ""),
    apiKey: env.WAHA_API_KEY || "",
    session: env.WAHA_SESSION || "default",
    webhookSecret: env.WAHA_WEBHOOK_SECRET || "",
    webhookUrl: env.WAHA_WEBHOOK_URL || "",
  };
}

export function loadConfig(env = process.env) {
  const channel = String(env.WHATSAPP_CHANNEL || "simulado").trim().toLowerCase();
  const port = toInt(env.PORT, 3000);
  return {
    port,
    publicUrl: String(env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    panelPassword: env.PANEL_PASSWORD || "",
    timeZone: env.TIMEZONE || "America/Sao_Paulo",
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    clinicDir: path.resolve(env.CLINIC_DIR || "./clinica"),
    labFile: path.resolve(env.LAB_FILE || "./lab/scenarios.json"),
    channel,
    ai: {
      model: env.AI_MODEL || "claude-opus-5-5",
      effort: EFFORTS.includes(env.AI_EFFORT) ? env.AI_EFFORT : "medium",
      dailyLimit: toInt(env.AI_DAILY_LIMIT, 300),
    },
    meta: metaConfig(env),
    waha: wahaConfig(env),
    pacing: {
      inboundWaitMs: toInt(env.INBOUND_WAIT_SECONDS, 20) * 1000,
      typingMsPerChar: toInt(env.TYPING_MS_PER_CHAR, 40),
      typingMaxMs: toInt(env.TYPING_MAX_SECONDS, 12) * 1000,
    },
    automations: {
      confirmationHoursBefore: toInt(env.CONFIRMATION_HOURS_BEFORE, 24),
      followUpDaysAfter: toInt(env.FOLLOWUP_DAYS_AFTER, 7),
      quietHours: parseQuietHours(env.QUIET_HOURS || "20-8"),
    },
  };
}

// Lista o que impede o servidor de subir com segurança.
export function configProblems(config) {
  const problems = [];
  if (!CHANNELS.includes(config.channel)) problems.push("WHATSAPP_CHANNEL deve ser simulado, oficial ou waha.");
  if (config.panelPassword.length < 12) problems.push("Defina PANEL_PASSWORD com pelo menos 12 caracteres.");
  if (!MODEL_PRICES[config.ai.model]) problems.push(`AI_MODEL desconhecido: use ${Object.keys(MODEL_PRICES).join(", ")}.`);
  if (config.channel === "oficial") {
    for (const [key, value] of Object.entries({ META_ACCESS_TOKEN: config.meta.accessToken, META_PHONE_NUMBER_ID: config.meta.phoneNumberId, META_APP_SECRET: config.meta.appSecret, META_VERIFY_TOKEN: config.meta.verifyToken })) {
      if (!value) problems.push(`Canal oficial: preencha ${key}.`);
    }
  }
  if (config.channel === "waha") {
    if (!config.waha.apiKey) problems.push("Canal WAHA: preencha WAHA_API_KEY.");
    if (config.waha.webhookSecret.length < 24) problems.push("Canal WAHA: WAHA_WEBHOOK_SECRET precisa de pelo menos 24 caracteres.");
  }
  return problems;
}
