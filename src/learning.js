// Aprendizado com as conversas, sempre com aprovação humana:
// 1) a equipe corrige uma resposta da IA → vira uma lição "para revisar";
// 2) a IA relê as conversas recentes e sugere lições → "para revisar";
// 3) só as lições aprovadas entram nas instruções da IA.
import { callModel, textOf, withFallbacks } from "./brain.js";
import { addApiUsage, emptyUsage, recordUsage } from "./budget.js";
import { listConversations, listMessages } from "./conversations.js";
import { newId } from "./ids.js";
import { getSettings } from "./settings.js";

const MAX_APPROVED = 50;
const AUTHOR_LABELS = { patient: "Paciente", ai: "IA", team: "Equipe", automation: "Automação", system: "Sistema" };

const LESSONS_SCHEMA = {
  type: "object",
  properties: {
    licoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["conhecimento", "regra", "tom"] },
          texto: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["tipo", "texto", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["licoes"],
  additionalProperties: false,
};

const REVIEW_SYSTEM = [
  "Você revisa as conversas de uma secretária virtual de clínica para melhorar o atendimento.",
  "Proponha no máximo 5 lições curtas e gerais, cada uma em uma frase no imperativo.",
  "Tipos: 'conhecimento' quando faltar uma informação na base (diga qual informação a clínica precisa preencher, sem inventar o valor); 'regra' para comportamento; 'tom' para o jeito de falar.",
  "Nunca inclua nomes, telefones, datas de consultas ou dados de saúde de pacientes.",
  "Não repita lições já aprovadas nem o que o roteiro já diz. Se não houver nada útil, devolva a lista vazia.",
].join("\n");

export function anonymize(text) {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]")
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[CPF]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]");
}

const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

function pushLessons(store, lessons) {
  store.update((state) => {
    state.lessons.push(...lessons);
  });
  return lessons;
}

export function createCorrectionLesson(store, { conversationId, messageId, idealAnswer, now }) {
  const messages = listMessages(store, conversationId);
  const index = messages.findIndex((item) => item.id === messageId && item.author === "ai");
  const answer = String(idealAnswer ?? "").trim();
  if (index === -1 || !answer) return { error: "Escolha uma resposta da IA e escreva como deveria ser." };
  const question = messages.slice(0, index).reverse().find((item) => item.author === "patient")?.text ?? "";
  const lesson = {
    id: newId("l"), kind: "regra", source: "correção da equipe", status: "pending", createdAt: now.toISOString(),
    text: `Quando o paciente disser algo como "${clip(anonymize(question), 160)}", responda no sentido de: "${clip(anonymize(answer), 300)}"`,
    reason: `A equipe corrigiu esta resposta da IA: "${clip(anonymize(messages[index].text), 200)}"`,
  };
  pushLessons(store, [lesson]);
  return { lesson };
}

function transcriptOf(store, conversation, sinceMs) {
  const lines = listMessages(store, conversation.id)
    .filter((item) => Date.parse(item.createdAt) >= sinceMs && item.text)
    .map((item) => `${AUTHOR_LABELS[item.author] ?? item.author}: ${anonymize(item.text)}`);
  return lines.join("\n");
}

function reviewPrompt(runtime, sinceMs) {
  const clinic = runtime.loadClinic();
  const approved = runtime.store.state.lessons.filter((item) => item.status === "approved").map((item) => `- ${item.text}`).join("\n") || "- nenhuma";
  const transcripts = listConversations(runtime.store)
    .filter((conversation) => Date.parse(conversation.lastMessageAt) >= sinceMs)
    .slice(0, 40)
    .map((conversation, index) => `## Conversa ${index + 1}\n${transcriptOf(runtime.store, conversation, sinceMs)}`)
    .filter((block) => block.includes("Paciente:"));
  if (!transcripts.length) return null;
  return [`# Roteiro atual\n${clinic.script}`, `# Base de conhecimento atual\n${clinic.knowledge}`, `# Lições já aprovadas\n${approved}`, `# Conversas para revisar\n${transcripts.join("\n\n")}`].join("\n\n");
}

function parseProposals(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.licoes) ? parsed.licoes.filter((item) => item?.texto).slice(0, 5) : null;
  } catch {
    return null;
  }
}

export async function proposeLessons(runtime, { days = 1 } = {}) {
  const now = runtime.clock();
  const prompt = reviewPrompt(runtime, now.getTime() - days * 86_400_000);
  if (!prompt) return { lessons: [], note: "Nenhuma conversa com paciente no período." };
  const settings = getSettings(runtime.store, runtime.config);
  const response = await callModel(runtime.client, withFallbacks({
    model: settings.model, max_tokens: 8000, system: REVIEW_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: LESSONS_SCHEMA } },
  }));
  recordUsage(runtime.store, { now, timeZone: runtime.config.timeZone, model: response.model || settings.model, usage: addApiUsage(emptyUsage(), response.usage), environment: "lab" });
  if (response.stop_reason !== "end_turn") return { lessons: [], note: "A revisão não terminou. Tente com menos dias." };
  const proposals = parseProposals(textOf(response));
  if (!proposals) return { lessons: [], note: "A revisão voltou num formato inesperado. Tente de novo." };
  return {
    lessons: pushLessons(runtime.store, proposals.map((item) => ({
      id: newId("l"), kind: item.tipo, text: clip(item.texto.trim(), 400), reason: clip(item.motivo.trim(), 400),
      source: "revisão da IA", status: "pending", createdAt: now.toISOString(),
    }))),
  };
}

export function decideLesson(store, { lessonId, approve, text, now }) {
  return store.update((state) => {
    const lesson = state.lessons.find((item) => item.id === lessonId);
    if (!lesson) return { error: "Lição não encontrada." };
    const approvedCount = state.lessons.filter((item) => item.status === "approved").length;
    if (approve && lesson.status !== "approved" && approvedCount >= MAX_APPROVED) {
      return { error: `Já são ${MAX_APPROVED} lições aprovadas. Leve as mais importantes para o roteiro e arquive as outras.` };
    }
    if (approve && text?.trim()) lesson.text = clip(text.trim(), 400);
    Object.assign(lesson, { status: approve ? "approved" : "rejected", decidedAt: now.toISOString() });
    return { lesson };
  });
}
