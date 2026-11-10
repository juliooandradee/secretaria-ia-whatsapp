// Chamadas HTTP para o WhatsApp. "uncertain" = não sabemos se a mensagem saiu
// (sem resposta ou erro do servidor): nesses casos nada é reenviado sozinho.
import { timingSafeEqual, createHash } from "node:crypto";

export class ChannelError extends Error {
  constructor(message, { uncertain = false, status = null, code = null } = {}) {
    super(message);
    this.name = "ChannelError";
    this.uncertain = uncertain;
    this.status = status;
    this.code = code;
  }
}

function describeFailure(payload, status) {
  const metaError = payload?.error;
  if (metaError?.code === 131047) return "Fora da janela de 24 horas: a Meta só aceita mensagem livre até 24h depois da última mensagem do paciente. Use um modelo aprovado.";
  if (metaError?.message) return `${metaError.message} (código ${metaError.code ?? status})`;
  if (typeof payload?.message === "string") return payload.message;
  return `O WhatsApp respondeu com erro ${status}.`;
}

export async function requestJson(url, { method = "POST", body, headers = {}, timeoutMs = 20_000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ChannelError(`Sem resposta do WhatsApp: ${error.message}`, { uncertain: true });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ChannelError(describeFailure(payload, response.status), {
      uncertain: response.status >= 500, status: response.status, code: payload?.error?.code ?? null,
    });
  }
  return payload;
}

// Compara segredos sem vazar informação pelo tempo de resposta.
export function safeEqual(expected, received) {
  const left = createHash("sha256").update(String(expected ?? "")).digest();
  const right = createHash("sha256").update(String(received ?? "")).digest();
  return Boolean(expected) && timingSafeEqual(left, right);
}
