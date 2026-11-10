// Ajustes que a equipe muda pelo painel. Só os campos desta lista podem ser alterados.
import { MODEL_PRICES } from "./budget.js";
import { MODES } from "./modes.js";
import { digitsOnly } from "./phone.js";

const EFFORTS = ["low", "medium", "high"];

export class ValidationError extends Error {}

export function defaultSettings(config) {
  return {
    mode: "lab",
    testNumbers: [],
    model: config.ai.model,
    effort: config.ai.effort,
    dailyLimit: config.ai.dailyLimit,
    confirmationsEnabled: false,
    followUpsEnabled: false,
  };
}

export function getSettings(store, config) {
  return { ...defaultSettings(config), ...store.state.settings };
}

const FIELD_PARSERS = {
  mode: (value) => (MODES.includes(value) ? value : invalid("Modo inválido.")),
  testNumbers: parseTestNumbers,
  model: (value) => (MODEL_PRICES[value] ? value : invalid("Modelo não suportado.")),
  effort: (value) => (EFFORTS.includes(value) ? value : invalid("Esforço deve ser low, medium ou high.")),
  dailyLimit: (value) => {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 0 && limit <= 10000 ? limit : invalid("Limite diário entre 0 e 10000.");
  },
  confirmationsEnabled: (value) => Boolean(value),
  followUpsEnabled: (value) => Boolean(value),
};

function invalid(message) {
  throw new ValidationError(message);
}

function parseTestNumbers(value) {
  if (!Array.isArray(value)) invalid("Envie os números de teste como lista.");
  const numbers = [...new Set(value.map(digitsOnly).filter(Boolean))];
  if (numbers.length > 20) invalid("No máximo 20 números de teste.");
  if (numbers.some((number) => number.length < 10 || number.length > 15)) invalid("Use DDI + DDD + número, só dígitos. Ex.: 5511999998888.");
  return numbers;
}

export function updateSettings(store, config, patch) {
  const changes = {};
  for (const [field, parse] of Object.entries(FIELD_PARSERS)) {
    if (patch && Object.hasOwn(patch, field)) changes[field] = parse(patch[field]);
  }
  store.update((state) => {
    state.settings = { ...state.settings, ...changes };
  });
  return getSettings(store, config);
}
