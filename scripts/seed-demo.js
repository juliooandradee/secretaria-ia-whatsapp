// Cria dados de DEMONSTRAÇÃO (pacientes fictícios) para conhecer o painel sem WhatsApp.
// Uso: npm run demo            (só cria se ainda não houver dados)
//      npm run demo -- --force (apaga data/db.json e recria a demonstração)
// As respostas "da IA" aqui são exemplos escritos à mão: para ver a IA de verdade, use o Laboratório.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { conversationIdFor } from "../src/conversations.js";
import { newId } from "../src/ids.js";
import { JsonStore } from "../src/store.js";
import { addDaysToLocalDate, localStamp, zonedTimeToUtc } from "../src/timezone.js";

const config = loadConfig();
const file = path.join(config.dataDir, "db.json");
const out = (line) => process.stdout.write(`${line}\n`);
const now = new Date();
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const today = localStamp(now, config.timeZone).slice(0, 10);
const at = (dayOffset, time) => zonedTimeToUtc(addDaysToLocalDate(today, dayOffset), time, config.timeZone);
const ai = (tools = [], cost = 0.0068) => ({ model: "claude-opus-5-5", costUsd: cost, tools, demo: true });

const CONVERSATIONS = [
  { name: "Carla Mendes", phone: "5500987650001", messages: [
    [52, "patient", "Oi, boa tarde! Queria marcar uma consulta"],
    [51, "ai", "Boa tarde, Carla! Aqui é a Clara, secretária virtual da Clínica Exemplo. Você prefere manhã ou tarde? Tem algum dia melhor na semana?", ai()],
    [49, "patient", "Quinta de manhã, se tiver"],
    [48, "ai", "Na quinta de manhã tenho 8h, 9h30 e 10h. Qual fica melhor para você?", ai(["ver_horarios_livres"], 0.0091)],
    [46, "patient", "9h30. Meu nome é Carla Mendes"],
    [45, "ai", "Prontinho, Carla! Sua consulta com a Dra. Ana Souza ficou para quinta às 9h30, na Rua das Flores, 123, sala 45. Chegue 10 minutos antes e traga seus exames anteriores. 😊", ai(["agendar_consulta"], 0.0102)],
    [44, "patient", "Perfeito, obrigada!"],
    [44, "ai", "Eu que agradeço! Até quinta.", ai([], 0.0041)],
  ] },
  { name: "Roberto Alves", phone: "5500987650002", owner: "human", unread: 1, attention: { reason: "Dúvida sobre remédio: a IA passou para a médica.", urgent: false }, messages: [
    [21, "patient", "Bom dia. O remédio que a doutora passou pode dar sono? Comecei ontem"],
    [20, "ai", "Bom dia, Roberto! Essa é uma dúvida para a Dra. Ana avaliar. Já passei para a equipe e alguém te responde em breve, tá bem?", ai(["chamar_humano"], 0.0074)],
    [20, "system", "Passou para a equipe: Dúvida sobre remédio: a IA passou para a médica."],
  ] },
  { name: "Fernanda Costa", phone: "5500987650003", messages: [
    [180, "automation", "Olá, Fernanda! Aqui é a Clara, da Clínica Exemplo. Passando para confirmar sua consulta amanhã às 14h com a Dra. Ana Souza. Você confirma? Se precisar, eu remarco.", { automation: "confirmation", demo: true }],
    [95, "patient", "Sim, confirmo!"],
    [94, "ai", "Obrigada, Fernanda! Consulta confirmada para amanhã às 14h. Até lá!", ai(["confirmar_presenca"], 0.0063)],
  ] },
  { name: "Lucas Pereira", phone: "5500987650004", owner: "human", messages: [
    [140, "patient", "Vocês emitem nota fiscal para eu pedir reembolso do plano?"],
    [139, "ai", "Boa pergunta, Lucas! Vou confirmar com a equipe para te passar certinho. Já já alguém te responde por aqui.", ai(["chamar_humano"], 0.0059)],
    [139, "system", "Passou para a equipe: Paciente pediu nota fiscal para reembolso."],
    [128, "team", "Oi, Lucas! Aqui é a Ana, da recepção. Emitimos sim. Me passa seu e-mail que eu envio logo depois da consulta.", { via: "painel" }],
    [120, "patient", "lucas.exemplo@email.com. Obrigado, Ana!"],
  ] },
  { name: "Juliana Rocha", phone: "5500987650005", owner: "human", attention: { reason: "Possível emergência: a IA orientou ligar para o 192.", urgent: true }, messages: [
    [9, "patient", "Estou com uma dor forte no peito e falta de ar"],
    [9, "ai", "Isso pode ser uma emergência. Ligue agora para o SAMU (192) ou vá ao pronto-socorro mais próximo. Já avisei a equipe da clínica para acompanhar você.", { rule: "emergência", model: null, costUsd: 0, demo: true }],
    [9, "system", "Passou para a equipe: Possível emergência: a IA orientou ligar para o 192."],
  ] },
  { name: "Marcos Teixeira", phone: "5500987650006", messages: [
    [33, "patient", "Quanto custa a consulta? Aceita Bradesco?"],
    [32, "ai", "Oi, Marcos! A consulta particular é R$ 350,00, no Pix, débito ou crédito em até 3x. E sim, atendemos Bradesco Saúde: é só trazer a carteirinha e um documento com foto. Quer que eu veja um horário?", ai([], 0.0066)],
  ] },
  { name: "Patrícia Gomes", phone: "5500987650007", messages: [
    [300, "automation", "Oi, Patrícia! Aqui é a Clara, da Clínica Exemplo. Como você está depois da consulta com a Dra. Ana Souza? Se precisar de algo, é só me chamar por aqui.", { automation: "followUp", demo: true }],
    [240, "patient", "Estou ótima, obrigada pelo cuidado!"],
    [239, "ai", "Que bom saber, Patrícia! Fico feliz. Qualquer coisa, é só chamar.", ai([], 0.0038)],
  ] },
  { name: "Antônio Ribeiro", phone: "5500987650008", unread: 1, messages: [
    [4, "patient", "Preciso remarcar minha consulta de sexta"],
    [3, "ai", "Claro, Antônio! Sua consulta está na sexta às 10h. Posso trocar para segunda às 14h, 15h ou 16h30. Qual prefere?", ai(["consultas_do_paciente", "ver_horarios_livres"], 0.0118)],
  ] },
];

const APPOINTMENTS = [
  ["Helena Duarte", "5500987650010", 0, "08:30", "done", "Retorno"],
  ["Paulo César", "5500987650011", 0, "09:00", "no_show", "Primeira consulta"],
  ["Sônia Prado", "5500987650012", 0, "15:00", "confirmed", "Retorno"],
  ["Beatriz Nunes", "5500987650013", 1, "08:30", "confirmed", "Primeira consulta", true],
  ["Fernanda Costa", "5500987650003", 1, "14:00", "confirmed", "Retorno", true],
  ["Rafael Lima", "5500987650014", 1, "16:00", "scheduled", "Primeira consulta", true],
  ["Carla Mendes", "5500987650001", 2, "09:30", "scheduled", "Primeira consulta"],
  ["Antônio Ribeiro", "5500987650008", 3, "10:00", "scheduled", "Retorno"],
];

const LESSONS = [
  ["approved", "regra", "correção da equipe", "Quando o paciente pedir nota fiscal ou recibo para reembolso, diga que a clínica emite e peça o e-mail para envio depois da consulta.", "A equipe corrigiu uma resposta que só passava o caso adiante."],
  ["approved", "tom", "revisão da IA", "Ao confirmar um agendamento, repita dia, hora e endereço e lembre de chegar 10 minutos antes.", "Pacientes perguntaram o endereço depois de agendar."],
  ["pending", "conhecimento", "revisão da IA", "Preencha na base se a clínica faz teleconsulta.", "Dois pacientes perguntaram esta semana e a IA precisou chamar a equipe."],
  ["pending", "regra", "correção da equipe", "Quando o paciente perguntar se a clínica atende crianças, responda que atende a partir de 12 anos, sempre com um responsável.", "A equipe corrigiu esta resposta da IA: \"Vou verificar com a equipe.\""],
  ["pending", "tom", "revisão da IA", "Depois da primeira mensagem, não repita \"Aqui é a Clara\".", "A apresentação apareceu duas vezes na mesma conversa."],
];

function conversationRecord(item, index) {
  const chatId = `${item.phone}@c.us`;
  const id = conversationIdFor("simulado", chatId);
  const messages = item.messages.map(([minutes, author, text, meta = {}]) => ({
    id: newId("m"), author, text, kind: author === "system" ? "note" : "text", createdAt: ago(minutes + index * 0.01),
    status: author === "patient" ? "received" : author === "system" ? null : "read", meta,
  }));
  const last = messages.at(-1);
  const lastPatient = [...messages].reverse().find((message) => message.author === "patient");
  const conversation = {
    id, channel: "simulado", chatId, phone: item.phone, name: item.name, owner: item.owner ?? "ai",
    attention: item.attention ? { ...item.attention, at: last.createdAt } : null, unread: item.unread ?? 0, generation: 1,
    securityStrikes: [], preview: messages.filter((message) => message.author !== "system").at(-1).text.slice(0, 120),
    lastMessageAt: last.createdAt, lastInboundAt: lastPatient?.createdAt ?? null, lastInboundExternalId: null, createdAt: messages[0].createdAt,
  };
  return { conversation, messages };
}

function appointmentRecord([patientName, phone, dayOffset, time, status, reason, confirmationSent], conversations) {
  const start = at(dayOffset, time);
  const conversation = Object.values(conversations).find((item) => item.phone === phone);
  return {
    id: newId("c"), conversationId: conversation?.id ?? conversationIdFor("simulado", `${phone}@c.us`), phone, patientName, reason,
    start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString(), status, createdAt: ago(3000),
    confirmationSentAt: confirmationSent ? ago(180) : null, followUpSentAt: null,
  };
}

const LAB_MESSAGES = [
  ["patient", "Vocês fazem teleconsulta?"],
  ["ai", "Boa pergunta! Essa informação eu não tenho aqui, então vou confirmar com a equipe e alguém te responde em breve, combinado?", ai(["chamar_humano"], 0.0071)],
  ["system", "A IA chamou a equipe: Paciente perguntou sobre teleconsulta, que não está na base de conhecimento."],
  ["patient", "Tá bom. E vocês atendem sábado?"],
  ["ai", "Aos sábados a clínica fica fechada. De segunda a quinta atendemos das 8h às 12h e das 14h às 18h, e na sexta das 8h às 12h. Quer que eu veja um horário?", ai([], 0.0064)],
];

function labRecord() {
  const id = newId("lab");
  const messages = LAB_MESSAGES.map(([author, text, meta = {}], index) => ({ id: newId("m"), author, text, createdAt: ago(30 - index), meta }));
  return { id, name: "Paciente de teste", phone: "550000000000", owner: "ai", messages, createdAt: ago(31) };
}

function seed(store) {
  store.update((state) => {
    state.demo = true;
    const lab = labRecord();
    state.lab.conversations[lab.id] = lab;
    state.settings = { mode: "live", testNumbers: ["5500999990000"], confirmationsEnabled: true, followUpsEnabled: true };
    CONVERSATIONS.forEach((item, index) => {
      const { conversation, messages } = conversationRecord(item, index);
      state.conversations[conversation.id] = conversation;
      state.messages[conversation.id] = messages;
    });
    state.appointments = APPOINTMENTS.map((item) => appointmentRecord(item, state.conversations));
    state.lessons = LESSONS.map(([status, kind, source, text, reason], index) => ({ id: newId("l"), status, kind, source, text, reason, createdAt: ago(600 - index * 40), decidedAt: status === "approved" ? ago(300) : undefined }));
    state.usage[today] = { replies: 37, labReplies: 12, requests: 61, inputTokens: 31_000, outputTokens: 12_400, cacheReadTokens: 171_000, cacheWriteTokens: 9_800, costUsd: 0.4316, unknownCost: 0 };
  });
  store.flush();
}

if (existsSync(file) && !process.argv.includes("--force")) {
  out(`Já existe ${file}. Use "npm run demo -- --force" para apagar e recriar a demonstração.`);
  process.exit(1);
}
if (existsSync(file)) rmSync(file);
seed(new JsonStore(file));
out(`Demonstração criada em ${file}. Rode "npm start" e abra ${config.publicUrl}/painel`);
