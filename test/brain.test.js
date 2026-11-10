import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest, generateReply, supportsServerFallback } from "../src/brain.js";
import { TOOL_DEFINITIONS } from "../src/tools.js";
import { fakeClient, textResponse, toolResponse } from "./helpers.js";

const settings = { model: "claude-opus-5-5", effort: "medium" };
const history = [{ role: "user", content: "Tem horário amanhã?" }];

test("o pedido usa cache no roteiro, esforço, ferramentas estritas e fallback do servidor", () => {
  const request = buildRequest({ settings, system: "ROTEIRO", context: "CONTEXTO", tools: TOOL_DEFINITIONS, messages: history });
  assert.equal(request.model, "claude-opus-5-5");
  assert.deepEqual(request.system[0], { type: "text", text: "ROTEIRO", cache_control: { type: "ephemeral" } });
  assert.equal(request.system[1].text, "CONTEXTO", "o que muda fica depois do cache");
  assert.deepEqual(request.output_config, { effort: "medium" });
  assert.equal(request.thinking, undefined, "Opus 5.5 pensa sozinho; desligar dá erro 400");
  assert.ok(request.tools.every((tool) => tool.strict === true && tool.input_schema.additionalProperties === false));
  assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(request.fallbacks, "default");
  assert.equal(supportsServerFallback("claude-haiku-5-5"), false);
  assert.equal(buildRequest({ settings: { ...settings, model: "claude-haiku-5-5" }, system: "R", context: "C", tools: [], messages: history }).fallbacks, undefined);
});

test("executa a ferramenta e devolve o texto final", async () => {
  const client = fakeClient([toolResponse("ver_horarios_livres", { a_partir_de: "2026-11-11", dias: 1, periodo: "manha" }), textResponse("Tenho 9h, 9h30 e 10h. Qual prefere?")]);
  const calls = [];
  const result = await generateReply({ client, settings, system: "R", context: "C", history, tools: TOOL_DEFINITIONS, runTool: async (name, input) => { calls.push({ name, input }); return "{\"ok\":true}"; } });
  assert.equal(result.status, "reply");
  assert.equal(result.text, "Tenho 9h, 9h30 e 10h. Qual prefere?");
  assert.deepEqual(result.toolsUsed, ["ver_horarios_livres"]);
  assert.equal(calls[0].input.periodo, "manha");
  const second = client.requests[1].messages;
  assert.equal(second.at(-2).role, "assistant");
  assert.equal(second.at(-2).content[0].type, "thinking", "o bloco de raciocínio volta intacto");
  assert.equal(second.at(-1).content[0].type, "tool_result");
  assert.equal(result.usage.requests, 2);
});

test("recusa, resposta cortada e excesso de ferramentas vão para a equipe", async () => {
  for (const response of [textResponse("x", { stop_reason: "refusal" }), textResponse("cortad", { stop_reason: "max_tokens" })]) {
    const result = await generateReply({ client: fakeClient([response]), settings, system: "R", context: "C", history, tools: [], runTool: async () => "" });
    assert.equal(result.status, "handoff");
  }
  const loop = fakeClient(Array.from({ length: 6 }, () => toolResponse("consultas_do_paciente", {})));
  const looped = await generateReply({ client: loop, settings, system: "R", context: "C", history, tools: TOOL_DEFINITIONS, runTool: async () => "{}" });
  assert.equal(looped.status, "handoff");
  assert.equal(loop.requests.length, 5);
});
