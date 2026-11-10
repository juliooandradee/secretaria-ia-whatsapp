// Peças do relatório do laboratório (npm run lab): ler os argumentos, conferir cada
// cenário e comparar modelos. Nada aqui chama a IA, então dá para testar sem gastar.
import { MODEL_OPTIONS } from "./budget.js";

const MODEL_IDS = MODEL_OPTIONS.map((option) => option.id);

export function modelLabel(model) {
  return MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model;
}

function readModelArg(arg, args) {
  if (arg.startsWith("--modelo=")) return arg.slice("--modelo=".length);
  return args.shift() ?? "";
}

// npm run lab [-- filtro] [--modelo claude-haiku-5-5] [--comparar]
export function parseLabArgs(argv, defaultModel) {
  const args = [...argv];
  const options = { filter: "", models: [defaultModel], error: null };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--comparar") options.models = [...MODEL_IDS];
    else if (arg === "--modelo" || arg.startsWith("--modelo=")) options.models = [readModelArg(arg, args)];
    else if (arg.startsWith("--")) options.error = `Opção desconhecida: ${arg}. Use --modelo <modelo> ou --comparar.`;
    else options.filter = arg;
  }
  const unknown = options.models.find((model) => !MODEL_IDS.includes(model));
  if (unknown !== undefined && !options.error) options.error = `Modelo desconhecido: "${unknown}". Use ${MODEL_IDS.join(", ")}.`;
  return options;
}

// Verificações automáticas de um cenário. Servem de alerta: a leitura humana continua valendo.
export function checkScenario(scenario, messages) {
  const reply = ([...messages].reverse().find((item) => item.author === "ai")?.text ?? "").toLowerCase();
  const tools = new Set(messages.flatMap((item) => item.meta?.tools ?? []));
  const checks = scenario.checks ?? {};
  const failures = [];
  for (const tool of checks.tools ?? []) if (!tools.has(tool)) failures.push(`não usou ${tool}`);
  for (const word of checks.mustContain ?? []) if (!reply.includes(word.toLowerCase())) failures.push(`faltou "${word}"`);
  for (const word of checks.mustNotContain ?? []) if (reply.includes(word.toLowerCase())) failures.push(`disse "${word}"`);
  if (checks.maxWords && reply.split(/\s+/).filter(Boolean).length > checks.maxWords) failures.push(`mais de ${checks.maxWords} palavras`);
  if (!reply) failures.push("sem resposta da IA");
  return failures;
}

// Tabela final do --comparar: um modelo por linha, com acertos e custo do mesmo teste.
export function comparisonTable(results) {
  const rows = results.map((result) => [modelLabel(result.model), `${result.passed}/${result.total}`, `US$ ${result.cost.toFixed(4)}`]);
  const header = ["Modelo", "Sem alerta", "Custo do teste"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join("   ").trimEnd();
  return [line(header), ...rows.map(line)];
}
