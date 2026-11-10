// Conversa com o Claude: chama o modelo, executa as ferramentas e devolve o texto final.
// Resposta cortada, recusa ou erro NUNCA viram mensagem para o paciente: vão para a equipe.
import Anthropic from "@anthropic-ai/sdk";
import { addApiUsage, emptyUsage } from "./budget.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOOL_ROUNDS = 5;

// O cliente só é criado na primeira chamada: o painel abre mesmo sem a chave configurada.
export function createAnthropicClient() {
  let client = null;
  const instance = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 }));
  return {
    messages: { create: (request) => instance().messages.create(request) },
    beta: { messages: { create: (request) => instance().beta.messages.create(request) } },
  };
}

// Se o filtro de segurança de um modelo recusar, a própria API tenta outro modelo.
export function supportsServerFallback(model) {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}

export function buildRequest({ settings, system, context, tools, messages, maxTokens = 16000 }) {
  const request = {
    model: settings.model,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
      { type: "text", text: context },
    ],
    messages,
    output_config: { effort: settings.effort },
  };
  if (tools?.length) request.tools = tools;
  return withFallbacks(request);
}

export function withFallbacks(request) {
  if (!supportsServerFallback(request.model)) return request;
  return { ...request, betas: [FALLBACK_BETA], fallbacks: "default" };
}

export function callModel(client, request) {
  return request.betas ? client.beta.messages.create(request) : client.messages.create(request);
}

export function textOf(response) {
  return response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}

async function runToolCalls(content, runTool, toolsUsed) {
  const calls = content.filter((block) => block.type === "tool_use");
  return Promise.all(calls.map(async (call) => {
    toolsUsed.push(call.name);
    try {
      return { type: "tool_result", tool_use_id: call.id, content: await runTool(call.name, call.input) };
    } catch (error) {
      return { type: "tool_result", tool_use_id: call.id, content: `Erro: ${error.message}`, is_error: true };
    }
  }));
}

async function interpret(response, messages, runTool, toolsUsed) {
  if (response.stop_reason === "refusal") return { status: "handoff", reason: "O filtro de segurança da IA recusou responder." };
  if (response.stop_reason === "max_tokens") return { status: "handoff", reason: "A resposta ficou longa demais e foi cortada." };
  if (response.stop_reason === "tool_use") {
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: await runToolCalls(response.content, runTool, toolsUsed) });
    return null;
  }
  const text = textOf(response);
  return text ? { status: "reply", text } : { status: "handoff", reason: "A IA não escreveu nenhuma resposta." };
}

// history: mensagens no formato da API, terminando com a mensagem do paciente.
export async function generateReply({ client, settings, system, context, history, tools, runTool }) {
  const messages = [...history];
  const usage = emptyUsage();
  const toolsUsed = [];
  let model = settings.model;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callModel(client, buildRequest({ settings, system, context, tools, messages }));
    addApiUsage(usage, response.usage);
    model = response.model || model;
    const outcome = await interpret(response, messages, runTool, toolsUsed);
    if (outcome) return { ...outcome, usage, toolsUsed, model };
  }
  return { status: "handoff", reason: "A IA usou ferramentas demais sem concluir.", usage, toolsUsed, model };
}

export function describeAiError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Chave da Anthropic inválida ou ausente (ANTHROPIC_API_KEY).";
  if (error instanceof Anthropic.RateLimitError) return "Limite de uso da Anthropic atingido. Tente de novo em instantes.";
  if (error instanceof Anthropic.BadRequestError) return `Pedido recusado pela API: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Erro da API da Anthropic (${error.status ?? "sem status"}).`;
  if (/api.?key|credential|auth/i.test(String(error?.message))) return "Configure a chave da Anthropic (ANTHROPIC_API_KEY) no servidor.";
  return `Falha ao gerar resposta: ${error?.message ?? error}`;
}
