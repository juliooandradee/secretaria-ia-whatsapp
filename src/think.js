// O mesmo caminho atende o WhatsApp e o laboratório: o que passa no teste é o que vai ao ar.
import { patientAppointments } from "./agenda.js";
import { describeAiError, generateReply } from "./brain.js";
import { emptyUsage, recordUsage } from "./budget.js";
import { logError } from "./log.js";
import { approvedLessons, buildContext, buildStableSystem, toApiMessages } from "./prompt.js";
import { createToolRunner, TOOL_DEFINITIONS } from "./tools.js";

function promptParts(runtime, { conversation, scope, now }) {
  const clinic = runtime.loadClinic();
  const appointments = patientAppointments(runtime.store.state, { scope, conversation, now });
  return {
    system: buildStableSystem({ clinic, lessons: approvedLessons(runtime.store) }),
    context: buildContext({ now, timeZone: runtime.config.timeZone, conversation, appointments, environment: scope }),
  };
}

export async function thinkReply(runtime, { conversation, messages, settings, scope }) {
  const now = runtime.clock();
  const { timeZone } = runtime.config;
  const handoff = { requested: false, reason: "", urgent: false };
  const history = toApiMessages(messages);
  if (history.at(-1)?.role !== "user") return { status: "skip", reason: "A última mensagem não é do paciente.", handoff };
  const runTool = createToolRunner({
    store: runtime.store, clinic: runtime.loadClinic, timeZone, now: runtime.clock, conversation, scope,
    onHandoff: (details) => Object.assign(handoff, details, { requested: true }),
  });
  try {
    const result = await generateReply({
      client: runtime.client, settings, tools: TOOL_DEFINITIONS, runTool, history,
      ...promptParts(runtime, { conversation, scope, now }),
    });
    const costUsd = recordUsage(runtime.store, { now, timeZone, model: result.model, usage: result.usage, environment: scope });
    return { ...result, costUsd, handoff };
  } catch (error) {
    logError("ai_failed", error, { conversationId: conversation.id });
    recordUsage(runtime.store, { now, timeZone, model: settings.model, usage: emptyUsage(), environment: scope });
    return { status: "handoff", reason: describeAiError(error), handoff, toolsUsed: [], costUsd: null, model: settings.model };
  }
}

export function replyMeta(result) {
  return {
    model: result.model ?? null,
    costUsd: result.costUsd ?? null,
    tools: result.toolsUsed ?? [],
    tokens: result.usage ? { input: result.usage.inputTokens, output: result.usage.outputTokens, cacheRead: result.usage.cacheReadTokens, cacheWrite: result.usage.cacheWriteTokens } : null,
  };
}
