// Confere o pedido que o SDK oficial da Anthropic realmente envia,
// usando uma API falsa local (nenhuma chamada paga).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createAnthropicClient, generateReply } from "../src/brain.js";

let server;
const received = [];

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      received.push({ path: request.url, headers: request.headers, body: JSON.parse(raw) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: "Olá! Como posso ajudar?" }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "sk-ant-teste-local";
});

after(() => server.close());

test("o SDK envia modelo, esforço, cache e o beta de fallback do servidor", async () => {
  const result = await generateReply({
    client: createAnthropicClient(), settings: { model: "claude-opus-5-5", effort: "medium" },
    system: "ROTEIRO", context: "CONTEXTO", history: [{ role: "user", content: "Oi" }], tools: [], runTool: async () => "",
  });
  assert.equal(result.text, "Olá! Como posso ajudar?");
  const [call] = received;
  assert.match(call.path, /\/v1\/messages/);
  assert.match(call.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(call.body.fallbacks, "default");
  assert.equal(call.body.model, "claude-opus-5-5");
  assert.deepEqual(call.body.output_config, { effort: "medium" });
  assert.deepEqual(call.body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(call.body.betas, undefined, "betas vira cabeçalho, não vai no corpo");
});
