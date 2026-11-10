// Simulador: testa o fluxo inteiro (modos, ritmo, painel ao vivo) sem conectar um WhatsApp.
// As "mensagens do paciente" entram pelo painel, em Conversas → Simular paciente.
import { randomBytes } from "node:crypto";

export function createSimulatedChannel() {
  const sent = [];
  const record = (conversation, payload) => {
    const externalId = `sim_${randomBytes(6).toString("hex")}`;
    sent.push({ externalId, chatId: conversation.chatId, ...payload });
    return { externalId };
  };
  return {
    name: "simulado",
    label: "Simulador (sem WhatsApp)",
    sent,
    async sendText(conversation, text) {
      return record(conversation, { text });
    },
    async sendTemplate(conversation, name, parameters) {
      return record(conversation, { template: name, parameters });
    },
    async markReadAndTyping() {},
    async stopTyping() {},
    async status() {
      return { connected: true, detail: "Sem WhatsApp: use Simular paciente no painel." };
    },
  };
}
