// Registro em uma linha JSON por evento. Nunca registre o texto das conversas.
const silent = Boolean(process.env.NODE_TEST_CONTEXT) && process.env.LOG_LEVEL !== "debug";

export function logInfo(event, details = {}) {
  write("info", event, details);
}

export function logError(event, error, details = {}) {
  write("error", event, { ...details, error: describeError(error) });
}

function write(level, event, details) {
  if (silent) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...details });
  process.stdout.write(`${line}\n`);
}

export function describeError(error) {
  if (!error) return undefined;
  if (error.status) return `${error.name || "Error"} ${error.status}: ${error.message}`;
  return String(error.message || error);
}
