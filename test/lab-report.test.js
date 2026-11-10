import assert from "node:assert/strict";
import { test } from "node:test";
import { checkScenario, comparisonTable, parseLabArgs } from "../src/lab-report.js";

test("npm run lab usa o modelo do .env; --modelo troca só no teste; --comparar roda os três", () => {
  assert.deepEqual(parseLabArgs([], "claude-opus-5-5"), { filter: "", models: ["claude-opus-5-5"], error: null });
  assert.deepEqual(parseLabArgs(["valor", "--modelo", "claude-haiku-5-5"], "claude-opus-5-5").models, ["claude-haiku-5-5"]);
  assert.equal(parseLabArgs(["valor", "--modelo=claude-sonnet-5-5"], "claude-opus-5-5").filter, "valor");
  assert.deepEqual(parseLabArgs(["--comparar"], "claude-opus-5-5").models, ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
});

test("modelo ou opção desconhecida param o laboratório antes de gastar IA", () => {
  assert.match(parseLabArgs(["--modelo", "gpt-5"], "claude-opus-5-5").error, /Modelo desconhecido: "gpt-5"/);
  assert.match(parseLabArgs(["--modelo"], "claude-opus-5-5").error, /Modelo desconhecido/);
  assert.match(parseLabArgs(["--comprar"], "claude-opus-5-5").error, /Opção desconhecida: --comprar/);
});

test("verificação de cenário aponta ferramenta que faltou, palavra proibida e resposta longa", () => {
  const scenario = { checks: { tools: ["chamar_humano"], mustContain: ["equipe"], mustNotContain: ["dipirona"], maxWords: 8 } };
  const messages = [
    { author: "patient", text: "Posso tomar dipirona?" },
    { author: "ai", text: "Pode tomar dipirona sim, é um remédio seguro para quase todo mundo.", meta: { tools: [] } },
  ];
  assert.deepEqual(checkScenario(scenario, messages), ["não usou chamar_humano", 'faltou "equipe"', 'disse "dipirona"', "mais de 8 palavras"]);
  const good = [{ author: "ai", text: "Vou passar para a equipe, tá?", meta: { tools: ["chamar_humano"] } }];
  assert.deepEqual(checkScenario(scenario, good), []);
});

test("tabela do --comparar mostra cada modelo com acertos e custo do mesmo teste", () => {
  const table = comparisonTable([
    { model: "claude-opus-5-5", passed: 20, total: 20, cost: 0.4 },
    { model: "claude-haiku-5-5", passed: 15, total: 20, cost: 0.012 },
  ]);
  assert.equal(table.length, 3);
  assert.match(table[0], /^Modelo\s+Sem alerta\s+Custo do teste$/);
  assert.match(table[1], /^Claude Opus 5\.5\s+20\/20\s+US\$ 0\.4000$/);
  assert.match(table[2], /^Claude Haiku 5\.5\s+15\/20\s+US\$ 0\.0120$/);
});
