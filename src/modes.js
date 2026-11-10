// As quatro fases da implantação, na ordem em que a secretária é liberada:
// laboratório → só números de teste → todos → (pausar quando precisar).
import { samePhone } from "./phone.js";

export const MODES = ["lab", "test", "live", "paused"];

export const MODE_LABELS = {
  lab: "Laboratório",
  test: "Só números de teste",
  live: "Ao vivo para todos",
  paused: "Pausado",
};

export function autoReplyDecision(settings, phone) {
  if (settings.mode === "paused") return { allowed: false, reason: "Envios pausados." };
  if (settings.mode === "lab") return { allowed: false, reason: "Modo laboratório: a IA só responde no laboratório." };
  if (settings.mode === "test" && !settings.testNumbers.some((number) => samePhone(number, phone))) {
    return { allowed: false, reason: "Número fora da lista de teste: fica com a equipe." };
  }
  return { allowed: true, reason: "" };
}

export function manualSendDecision(settings) {
  if (settings.mode === "paused") return { allowed: false, reason: "Envios pausados: nada sai, nem mensagem da equipe." };
  return { allowed: true, reason: "" };
}
