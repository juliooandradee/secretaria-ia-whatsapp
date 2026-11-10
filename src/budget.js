// Custos e limite diário. Preços por milhão de tokens (US$), conferidos em
// https://platform.claude.com/docs/en/about-claude/pricing em 10/11/2026.
import { zonedParts } from "./timezone.js";

export const MODEL_OPTIONS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Melhor qualidade. Comece por ele." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Metade do preço. Teste no laboratório antes de trocar." },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "O mais barato. Bom para volume alto e respostas simples." },
];

export const MODEL_PRICES = {
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
};

export function emptyUsage() {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addApiUsage(total, usage) {
  total.requests += 1;
  total.inputTokens += usage?.input_tokens ?? 0;
  total.outputTokens += usage?.output_tokens ?? 0;
  total.cacheReadTokens += usage?.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += usage?.cache_creation_input_tokens ?? 0;
  return total;
}

// Custo desconhecido fica null: nunca inventamos zero.
export function estimateCostUsd(model, usage) {
  const price = MODEL_PRICES[model];
  if (!price || !usage) return null;
  const total = usage.inputTokens * price.input
    + usage.cacheWriteTokens * price.cacheWrite
    + usage.cacheReadTokens * price.cacheRead
    + usage.outputTokens * price.output;
  return total / 1_000_000;
}

export function todayKey(now, timeZone) {
  return zonedParts(now, timeZone).date;
}

function emptyDay() {
  return { replies: 0, labReplies: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unknownCost: 0 };
}

export function recordUsage(store, { now, timeZone, model, usage, environment }) {
  const cost = estimateCostUsd(model, usage);
  store.update((state) => {
    const day = (state.usage[todayKey(now, timeZone)] ??= emptyDay());
    day[environment === "lab" ? "labReplies" : "replies"] += 1;
    for (const key of ["requests", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) day[key] += usage[key] ?? 0;
    if (cost === null) day.unknownCost += 1;
    else day.costUsd += cost;
  });
  return cost;
}

export function usageToday(store, now, timeZone) {
  return store.state.usage[todayKey(now, timeZone)] ?? emptyDay();
}

export function hasDailyBudget(store, settings, now, timeZone) {
  const day = usageToday(store, now, timeZone);
  return day.replies + day.labReplies < settings.dailyLimit;
}
