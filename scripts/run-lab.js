// Roda os cenários de lab/scenarios.json com a IA de verdade e mostra um relatório.
// Uso: npm run lab                                (todos, no modelo do .env)
//      npm run lab -- valor                       (só os cenários cujo id contém "valor")
//      npm run lab -- --modelo claude-haiku-5-5   (testa outro modelo sem mexer no .env)
//      npm run lab:comparar                       (os mesmos cenários no Opus, no Sonnet e no Haiku)
// Nada é enviado ao WhatsApp e nada é gravado em data/: usa um banco temporário em memória.
import { readFileSync } from "node:fs";
import { createSimulatedChannel } from "../src/channels/simulated.js";
import { loadConfig } from "../src/config.js";
import { labReply } from "../src/lab.js";
import { checkScenario, comparisonTable, modelLabel, parseLabArgs } from "../src/lab-report.js";
import { createRuntime } from "../src/runtime.js";
import { JsonStore } from "../src/store.js";

const baseConfig = loadConfig();
const options = parseLabArgs(process.argv.slice(2), baseConfig.ai.model);
const out = (line = "") => process.stdout.write(`${line}\n`);

async function runScenario(runtime, scenario) {
  let conversation = null;
  for (const text of scenario.messages) conversation = await labReply(runtime, { labId: conversation?.id, text });
  const failures = checkScenario(scenario, conversation.messages);
  const cost = conversation.messages.reduce((sum, item) => sum + (item.meta?.costUsd ?? 0), 0);
  out(`\n${failures.length ? "✗" : "✓"} ${scenario.title}  (US$ ${cost.toFixed(4)})`);
  for (const message of conversation.messages) {
    const label = { patient: "Paciente", ai: "IA", system: "Sistema" }[message.author] ?? message.author;
    const tools = message.meta?.tools?.length ? `  [${message.meta.tools.join(", ")}]` : "";
    out(`   ${label}: ${message.text.replace(/\n/g, " ")}${tools}`);
  }
  if (failures.length) out(`   → revisar: ${failures.join("; ")}`);
  out(`   Esperado: ${scenario.expect}`);
  return { failures, cost };
}

// Cada modelo roda num banco temporário próprio: um teste não interfere no outro.
async function runModel(model, scenarios) {
  const config = { ...baseConfig, ai: { ...baseConfig.ai, model } };
  const runtime = createRuntime(config, { store: new JsonStore(null), channel: createSimulatedChannel() });
  out(`\nLaboratório · ${modelLabel(model)} · ${scenarios.length} cenário(s) · esforço ${config.ai.effort}`);
  let cost = 0;
  let passed = 0;
  for (const scenario of scenarios) {
    const result = await runScenario(runtime, scenario);
    cost += result.cost;
    if (!result.failures.length) passed += 1;
  }
  out(`\nResultado · ${modelLabel(model)}: ${passed}/${scenarios.length} sem alerta automático · custo estimado US$ ${cost.toFixed(4)}`);
  return { model, passed, total: scenarios.length, cost };
}

function startProblem() {
  if (options.error) return options.error;
  if (!process.env.ANTHROPIC_API_KEY) return "Configure ANTHROPIC_API_KEY no .env para rodar o laboratório com a IA de verdade.";
  return null;
}

async function main() {
  const problem = startProblem();
  if (problem) {
    out(problem);
    process.exitCode = 1;
    return;
  }
  const scenarios = JSON.parse(readFileSync(baseConfig.labFile, "utf8")).filter((item) => item.id.includes(options.filter));
  const results = [];
  for (const model of options.models) results.push(await runModel(model, scenarios));
  if (results.length > 1) {
    out("\nComparação dos modelos (mesmos cenários):");
    for (const line of comparisonTable(results)) out(`   ${line}`);
    out("Fique com o mais barato que acertou o que importa para a sua clínica.");
  }
  out("Leia as respostas: as verificações automáticas não substituem a revisão humana.");
}

main();
