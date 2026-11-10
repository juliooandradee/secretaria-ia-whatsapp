// Ponto de entrada: npm start
import { recoverPending } from "./assistant.js";
import { configProblems, loadConfig } from "./config.js";
import { createAppServer } from "./http/index.js";
import { logInfo } from "./log.js";
import { createRuntime } from "./runtime.js";
import { startScheduler } from "./scheduler.js";

const config = loadConfig();
const problems = configProblems(config);
if (problems.length) {
  process.stderr.write(`Não foi possível iniciar a secretária:\n- ${problems.join("\n- ")}\n`);
  process.exit(1);
}

const runtime = createRuntime(config);
const server = createAppServer(runtime);
const stopScheduler = startScheduler(runtime);

server.listen(config.port, () => {
  logInfo("server_started", { port: config.port, channel: config.channel, panel: `${config.publicUrl}/painel` });
  const recovered = recoverPending(runtime);
  if (recovered) logInfo("pending_replies_recovered", { count: recovered });
});

function shutdown(signal) {
  logInfo("server_stopping", { signal });
  stopScheduler();
  runtime.debouncer.stopAll();
  runtime.store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
