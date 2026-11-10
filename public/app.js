"use strict";
// Painel da secretária. Sem framework: tudo é montado com el() e nunca com innerHTML,
// porque as mensagens dos pacientes são texto livre.

const state = {
  snapshot: null, tab: "conversas", activeId: null, detail: null, filter: "all", search: "",
  lab: { scenarios: [], conversations: [], activeId: null, results: {}, busy: false },
  appointments: [], lessons: [], whatsapp: null,
};

const AUTHOR_LABELS = { patient: "Paciente", ai: "IA", team: "Equipe", automation: "Automação" };
const STATUS_TEXT = { sending: "enviando…", sent: "✓", delivered: "✓✓", read: "✓✓ lida", uncertain: "⚠ envio incerto", failed: "✕ não enviada", received: "" };
const MODEL_SHORT = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" };
const AVATAR_COLORS = ["#2f6b4f", "#89764b", "#5b6236", "#713f2a", "#3d5a80", "#8a5a44", "#4f6d5e"];
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

// ---------- utilidades ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = (selector) => document.querySelector(selector);

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
  return payload;
}

let toastTimer = null;
function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = isError ? "toast error" : "toast";
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3800);
}

function guarded(action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      toast(error.message, true);
    }
  };
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}

function avatar(name) {
  const seed = [...String(name)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return el("div", { class: "avatar", style: `background:${AVATAR_COLORS[seed % AVATAR_COLORS.length]}` }, initials(name));
}

function timeLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === yesterday.toDateString()) return "ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const money = (value) => (value === null || value === undefined ? "custo desconhecido" : usd.format(value));

// ---------- abas ----------
function setTab(tab, { push = true } = {}) {
  state.tab = tab;
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("on", button.dataset.tab === tab));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("on", view.dataset.view === tab));
  if (push) history.replaceState(null, "", `#${tab}${tab === "conversas" && state.activeId ? `/${state.activeId}` : ""}`);
  const loaders = { laboratorio: loadLab, agenda: loadAgenda, aprendizado: loadLessons, ajustes: renderSettings };
  if (loaders[tab]) guarded(loaders[tab])();
}

// ---------- topo ----------
function renderHeader() {
  const { settings, modes, channel, usage, demo, conversations } = state.snapshot;
  const modePill = $("#mode-pill");
  modePill.textContent = modes[settings.mode];
  modePill.className = `pill ${settings.mode}`;
  $("#channel-pill").textContent = channel.label;
  const replies = usage.replies + usage.labReplies;
  $("#usage-pill").textContent = `IA hoje: ${replies}/${settings.dailyLimit} · ${money(usage.costUsd)}`;
  $("#demo-ribbon").hidden = !demo;
  const attention = conversations.filter((item) => item.attention).length;
  $("#attention-count").textContent = attention;
  $("#attention-count").hidden = attention === 0;
  $("#simulator").hidden = channel.name !== "simulado";
}

async function refreshSnapshot() {
  state.snapshot = await api("/api/state");
  renderHeader();
  renderList();
}

// ---------- conversas ----------
function filteredConversations() {
  const term = state.search.trim().toLowerCase();
  return state.snapshot.conversations.filter((item) => {
    if (term && !item.name.toLowerCase().includes(term)) return false;
    if (state.filter === "attention") return Boolean(item.attention);
    if (state.filter === "human") return item.owner === "human";
    if (state.filter === "ai") return item.owner === "ai";
    return true;
  });
}

function attentionTag(conversation) {
  if (!conversation.attention) return conversation.isTestNumber ? el("span", { class: "tag test" }, "teste") : null;
  return el("span", { class: conversation.attention.urgent ? "tag urgent" : "tag alert" }, conversation.attention.urgent ? "urgente" : "atenção");
}

function conversationItem(conversation) {
  const owner = el("span", { class: conversation.owner === "ai" ? "tag" : "tag human" }, conversation.owner === "ai" ? "IA" : "Equipe");
  return el("div", { class: `item${conversation.id === state.activeId ? " on" : ""}`, onclick: () => guarded(openConversation)(conversation.id) },
    avatar(conversation.name),
    el("div", { class: "middle" },
      el("div", { class: "name" }, el("span", {}, conversation.name), attentionTag(conversation)),
      el("div", { class: "preview" }, conversation.preview || "—")),
    el("div", { class: "side" }, timeLabel(conversation.lastMessageAt), conversation.unread ? el("span", { class: "unread" }, conversation.unread) : owner));
}

function renderList() {
  const items = filteredConversations();
  $("#conversation-list").replaceChildren(...(items.length ? items.map(conversationItem) : [el("div", { class: "empty-card", style: "margin:12px" }, "Nenhuma conversa por aqui.")]));
}

async function openConversation(conversationId) {
  state.activeId = conversationId;
  state.detail = await api(`/api/conversations/${conversationId}`);
  $(".conversas").classList.add("has-chat");
  history.replaceState(null, "", `#conversas/${conversationId}`);
  renderList();
  renderChat({ scroll: true });
  if (state.detail.conversation.unread) api(`/api/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
}

function conversationAction(path, message) {
  return guarded(async () => {
    await api(`/api/conversations/${state.activeId}/${path}`, { method: "POST" });
    toast(message);
    await openConversation(state.activeId);
  });
}

function chatHeader(conversation) {
  const ownerAction = conversation.owner === "ai"
    ? el("button", { type: "button", class: "btn small warn", onclick: conversationAction("take-over", "Você assumiu. A IA parou nesta conversa.") }, "Assumir conversa")
    : el("button", { type: "button", class: "btn small", onclick: conversationAction("hand-back", "Conversa devolvida à IA.") }, "Devolver à IA");
  return el("div", { class: "chat-head" },
    el("button", { type: "button", class: "btn ghost small mobile-back", onclick: () => $(".conversas").classList.remove("has-chat") }, "←"),
    avatar(conversation.name),
    el("div", { class: "who" }, el("b", {}, conversation.name), el("span", {}, `Telefone ${conversation.phone} · ${conversation.owner === "ai" ? "IA atendendo" : "Equipe atendendo"}`)),
    el("div", { class: "actions" }, ownerAction));
}

function attentionBanner(conversation) {
  if (!conversation.attention) return null;
  return el("div", { class: `banner${conversation.attention.urgent ? " urgent" : ""}` },
    el("span", {}, conversation.attention.reason),
    el("button", { type: "button", class: "btn ghost small", onclick: conversationAction("resolve", "Marcado como resolvido.") }, "Resolvido"));
}

function messageMeta(message, conversationId) {
  const meta = message.meta ?? {};
  const parts = [];
  if (message.author === "ai" && meta.model) parts.push(el("span", {}, MODEL_SHORT[meta.model] ?? meta.model));
  if (message.author === "ai" && meta.rule) parts.push(el("span", {}, `regra: ${meta.rule} · sem IA`));
  if (message.author === "ai" && meta.costUsd !== undefined && meta.model) parts.push(el("span", {}, money(meta.costUsd)));
  for (const tool of meta.tools ?? []) parts.push(el("span", { class: "tool" }, tool));
  if (meta.via === "celular") parts.push(el("span", {}, "pelo celular"));
  if (meta.automation) parts.push(el("span", { class: "tool" }, meta.automation === "confirmation" ? "confirmação" : "retorno"));
  parts.push(el("span", {}, timeLabel(message.createdAt)));
  if (message.author !== "patient" && STATUS_TEXT[message.status]) parts.push(el("span", { class: `status-${message.status}` }, STATUS_TEXT[message.status]));
  if (message.author === "ai" && conversationId) parts.push(el("button", { type: "button", onclick: (event) => toggleCorrection(event, message, conversationId) }, "Corrigir"));
  return el("div", { class: "meta" }, parts);
}

function toggleCorrection(event, message, conversationId) {
  const bubble = event.target.closest(".bubble");
  const existing = bubble.querySelector(".correction");
  if (existing) return existing.remove();
  const field = el("textarea", { placeholder: "Como a IA deveria ter respondido?" });
  const save = guarded(async () => {
    await api(`/api/conversations/${conversationId}/messages/${message.id}/correction`, { method: "POST", body: { idealAnswer: field.value } });
    toast("Lição criada. Revise em Aprendizado.");
    bubble.querySelector(".correction")?.remove();
  });
  bubble.append(el("div", { class: "correction" }, field, el("button", { type: "button", class: "btn small", onclick: save }, "Salvar como lição")));
  field.focus();
  return undefined;
}

function messageNode(message, conversationId) {
  if (message.author === "system") return el("div", { class: "note-line" }, message.text);
  const text = message.text || (message.kind && message.kind !== "text" ? "📎 Anexo (foto, áudio ou arquivo)" : "");
  return el("div", { class: `bubble ${message.author}` },
    message.author !== "patient" ? el("span", { class: "who" }, AUTHOR_LABELS[message.author]) : null,
    text,
    messageMeta(message, conversationId));
}

function composer(conversation) {
  const field = el("textarea", { placeholder: "Responder como equipe…", "aria-label": "Mensagem da equipe" });
  const send = guarded(async () => {
    if (!field.value.trim()) return;
    await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: { text: field.value } });
    field.value = "";
    await openConversation(conversation.id);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  const hint = conversation.owner === "ai" ? "Ao enviar, você assume a conversa e a IA para de responder nela." : "Enter envia · Shift + Enter quebra a linha.";
  return el("div", { class: "composer" }, field, el("button", { type: "button", class: "btn", onclick: send }, "Enviar"), el("div", { class: "hint" }, hint));
}

function renderChat({ scroll = false } = {}) {
  const chat = $("#chat");
  if (!state.detail) return chat.replaceChildren(el("div", { class: "empty" }, "Escolha uma conversa"));
  const { conversation, messages } = state.detail;
  const list = el("div", { class: "messages" }, messages.map((message) => messageNode(message, conversation.id)));
  const previous = chat.querySelector(".messages");
  const nearBottom = !previous || previous.scrollHeight - previous.scrollTop - previous.clientHeight < 80;
  chat.replaceChildren(chatHeader(conversation), attentionBanner(conversation) ?? "", list, composer(conversation));
  if (scroll || nearBottom) list.scrollTop = list.scrollHeight;
  return undefined;
}

// ---------- laboratório ----------
async function loadLab() {
  const data = await api("/api/lab");
  state.lab.scenarios = data.scenarios;
  state.lab.conversations = data.conversations;
  if (!state.lab.conversations.some((item) => item.id === state.lab.activeId)) state.lab.activeId = state.lab.conversations[0]?.id ?? null;
  renderLab();
}

function lastAi(messages) {
  return [...messages].reverse().find((item) => item.author === "ai")?.text ?? "";
}

function evaluateChecks(scenario, messages) {
  const checks = scenario.checks ?? {};
  const reply = lastAi(messages).toLowerCase();
  const tools = new Set(messages.flatMap((item) => item.meta?.tools ?? []));
  const failures = [];
  for (const tool of checks.tools ?? []) if (!tools.has(tool)) failures.push(`não usou ${tool}`);
  for (const word of checks.mustContain ?? []) if (!reply.includes(word.toLowerCase())) failures.push(`faltou "${word}"`);
  for (const word of checks.mustNotContain ?? []) if (reply.includes(word.toLowerCase())) failures.push(`disse "${word}"`);
  if (checks.maxWords && reply.split(/\s+/).filter(Boolean).length > checks.maxWords) failures.push(`mais de ${checks.maxWords} palavras`);
  if (!reply) failures.push("sem resposta da IA");
  return failures;
}

async function runScenario(scenario) {
  state.lab.busy = true;
  renderLab();
  let conversation = null;
  try {
    for (const text of scenario.messages) {
      conversation = await api("/api/lab/messages", { method: "POST", body: { labId: conversation?.id, text } });
      state.lab.activeId = conversation.id;
      await loadLab();
    }
    state.lab.results[scenario.id] = evaluateChecks(scenario, conversation.messages);
  } finally {
    state.lab.busy = false;
    renderLab();
  }
}

function scenarioCard(scenario) {
  const result = state.lab.results[scenario.id];
  const badge = result ? el("span", { class: `check ${result.length ? "fail" : "pass"}`, title: result.join(", ") }, result.length ? `revisar: ${result.join(", ")}` : "passou") : null;
  return el("div", { class: "scenario" },
    el("b", {}, scenario.title),
    el("p", {}, `“${scenario.messages.join(" → ")}”`),
    el("p", {}, `Esperado: ${scenario.expect}`),
    el("div", { class: "row-actions" }, badge ?? el("span"), el("button", { type: "button", class: "btn small ghost", disabled: state.lab.busy, onclick: guarded(() => runScenario(scenario)) }, "Testar")));
}

function labChat() {
  const conversation = state.lab.conversations.find((item) => item.id === state.lab.activeId);
  const field = el("textarea", { placeholder: state.lab.busy ? "A IA está respondendo…" : "Escreva como se fosse o paciente…", "aria-label": "Mensagem de teste" });
  const send = guarded(async () => {
    if (!field.value.trim()) return;
    const text = field.value;
    field.value = "";
    state.lab.busy = true;
    const updated = await api("/api/lab/messages", { method: "POST", body: { labId: state.lab.activeId, text } }).finally(() => { state.lab.busy = false; });
    state.lab.activeId = updated.id;
    await loadLab();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  const messages = el("div", { class: "messages" }, (conversation?.messages ?? []).map((message) => messageNode(message, null)));
  const head = el("div", { class: "chat-head" }, avatar("Paciente Teste"), el("div", { class: "who" }, el("b", {}, "Laboratório"), el("span", {}, "Paciente de teste · nada sai para o WhatsApp")));
  return [head, messages, el("div", { class: "composer" }, field, el("button", { type: "button", class: "btn", disabled: state.lab.busy, onclick: send }, "Enviar"))];
}

function renderLab() {
  $("#scenario-list").replaceChildren(...state.lab.scenarios.map(scenarioCard));
  const nodes = labChat();
  $("#lab-chat").replaceChildren(...nodes);
  nodes[1].scrollTop = nodes[1].scrollHeight;
}

// ---------- agenda ----------
async function loadAgenda() {
  const data = await api("/api/appointments");
  state.appointments = data.appointments;
  renderAgenda();
}

function automationSwitch(field, title, detail) {
  const input = el("input", { type: "checkbox", checked: state.snapshot.settings[field] });
  input.addEventListener("change", guarded(async () => {
    state.snapshot.settings = await api("/api/settings", { method: "PUT", body: { [field]: input.checked } });
    toast(input.checked ? "Automação ligada." : "Automação desligada.");
  }));
  return el("label", { class: "switch" }, input, el("div", {}, el("b", {}, title), el("small", {}, detail)));
}

function appointmentRow(item) {
  const select = el("select", { "aria-label": "Mudar situação" },
    el("option", { value: "" }, "Mudar…"), el("option", { value: "done" }, "Realizada"), el("option", { value: "no_show" }, "Faltou"),
    el("option", { value: "confirmed" }, "Confirmada"), el("option", { value: "cancelled" }, "Cancelada"));
  select.addEventListener("change", guarded(async () => {
    if (!select.value) return;
    await api(`/api/appointments/${item.id}/status`, { method: "POST", body: { status: select.value } });
    await loadAgenda();
  }));
  const chips = [el("span", { class: `chip ${item.status}` }, item.statusLabel)];
  if (item.confirmationSentAt) chips.push(el("span", { class: "chip" }, "confirmação enviada"));
  if (item.followUpSentAt) chips.push(el("span", { class: "chip" }, "retorno enviado"));
  const hour = new Date(item.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return el("div", { class: "appointment" },
    el("div", { class: "time" }, hour),
    el("div", { class: "who" }, el("b", {}, item.patientName || item.conversationName || "Paciente"), el("span", {}, `${item.reason || "Consulta"} · telefone ${item.phone}`)),
    el("div", { class: "chips" }, chips), select);
}

function dayTitle(iso) {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === tomorrow.toDateString()) return "Amanhã";
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function renderAgenda() {
  $("#automations").replaceChildren(
    automationSwitch("confirmationsEnabled", "Confirmar consultas automaticamente", "Pergunta no dia anterior se o paciente confirma. Respostas como “sim” a IA registra sozinha."),
    automationSwitch("followUpsEnabled", "Perguntar como o paciente está", "Alguns dias depois de uma consulta marcada como realizada. Queixas clínicas vão para a equipe."));
  const groups = new Map();
  for (const item of state.appointments) {
    const title = dayTitle(item.start);
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  const days = [...groups].map(([title, items]) => el("div", { class: "day" }, el("h3", {}, title), items.map(appointmentRow)));
  $("#appointment-list").replaceChildren(...(days.length ? days : [el("div", { class: "empty-card" }, "Nenhuma consulta marcada ainda. A IA agenda pelo WhatsApp.")]));
}

// ---------- aprendizado ----------
async function loadLessons() {
  const data = await api("/api/lessons");
  state.lessons = data.lessons;
  renderLessons();
}

function lessonCard(lesson) {
  const text = el("textarea", {}, lesson.text);
  const decide = (approve) => guarded(async () => {
    await api(`/api/lessons/${lesson.id}/decision`, { method: "POST", body: { approve, text: text.value } });
    toast(approve ? "Lição aprovada: a IA já usa na próxima resposta." : "Lição descartada.");
    await loadLessons();
  });
  const isPending = lesson.status === "pending";
  return el("div", { class: "lesson" },
    el("div", { class: "top-line" }, el("span", { class: "tag" }, lesson.kind), lesson.source, " · ", timeLabel(lesson.createdAt)),
    isPending ? text : el("div", {}, lesson.text),
    lesson.reason ? el("div", { class: "why" }, lesson.reason) : null,
    el("div", { class: "row-actions" }, isPending ? el("button", { type: "button", class: "btn small", onclick: decide(true) }, "Aprovar") : null,
      el("button", { type: "button", class: "btn small ghost", onclick: decide(false) }, isPending ? "Descartar" : "Tirar do uso")));
}

function renderLessons() {
  const pending = state.lessons.filter((item) => item.status === "pending").reverse();
  const approved = state.lessons.filter((item) => item.status === "approved");
  const emptyCard = (text) => el("div", { class: "empty-card" }, text);
  $("#pending-lessons").replaceChildren(...(pending.length ? pending.map(lessonCard) : [emptyCard("Nada para revisar. Corrija uma resposta da IA nas conversas ou peça uma revisão.")]));
  $("#approved-lessons").replaceChildren(...(approved.length ? approved.map(lessonCard) : [emptyCard("Nenhuma lição aprovada ainda.")]));
  $("#pending-count").textContent = pending.length;
  $("#pending-count").hidden = pending.length === 0;
}

async function reviewWithAi() {
  const button = $("#review-button");
  button.disabled = true;
  button.textContent = "Revisando…";
  try {
    const result = await api("/api/lessons/review", { method: "POST", body: { days: Number($("#review-days").value) } });
    toast(result.note ?? `${result.lessons.length} sugestão(ões) para revisar.`);
    await loadLessons();
  } finally {
    button.disabled = false;
    button.textContent = "Revisar com a IA";
  }
}

// ---------- ajustes ----------
const MODE_HINTS = {
  lab: "A IA só responde no Laboratório. O WhatsApp recebe e a equipe responde.",
  test: "A IA responde só os números da lista de teste (comece pelo seu).",
  live: "A IA responde todos os pacientes. A equipe acompanha ao vivo.",
  paused: "Nada sai: nem IA, nem automações, nem equipe. Mensagens continuam chegando.",
};

function radioOption(name, value, checked, title, detail, extra = null) {
  return el("label", { class: "option" }, el("input", { type: "radio", name, value, checked }), el("b", {}, title), extra, el("small", {}, detail));
}

const plainUsd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });

function priceLine(price) {
  return el("span", { class: "price" }, `${plainUsd.format(price.input)} entrada · ${plainUsd.format(price.output)} saída · por milhão de tokens`);
}

function usageStats() {
  const { usage } = state.snapshot;
  const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label));
  return el("div", { class: "inline" }, stat(usage.replies, "respostas no WhatsApp hoje"), stat(usage.labReplies, "testes no laboratório hoje"), stat(money(usage.costUsd), "custo estimado hoje"));
}

function settingsCards(settings) {
  const { modes, models } = state.snapshot;
  return [
    el("div", { class: "panel-card" }, el("h3", {}, "Fase do atendimento"), el("div", { class: "options" }, Object.entries(modes).map(([value, title]) => radioOption("mode", value, settings.mode === value, title, MODE_HINTS[value])))),
    el("div", { class: "panel-card" }, el("h3", {}, "Números de teste"), el("p", {}, "Um por linha, com DDI e DDD (ex.: 5511999998888). Na fase de teste, só eles recebem resposta da IA."),
      el("textarea", { name: "testNumbers", rows: 3, style: "width:100%;margin-top:8px" }, settings.testNumbers.join("\n"))),
    el("div", { class: "panel-card" }, el("h3", {}, "Modelo de IA"), el("p", {}, "Comece pelo melhor. Depois teste os mais baratos no Laboratório antes de trocar."),
      el("div", { class: "options", style: "margin-top:10px" }, models.map((model) => radioOption("model", model.id, settings.model === model.id, model.label, model.hint, priceLine(model.price)))),
      el("div", { class: "inline", style: "margin-top:12px" }, el("label", {}, "Esforço de raciocínio "),
        el("select", { name: "effort" }, ["low", "medium", "high"].map((value) => el("option", { value, selected: settings.effort === value }, { low: "Baixo (mais rápido e barato)", medium: "Médio (recomendado)", high: "Alto" }[value]))))),
    el("div", { class: "panel-card" }, el("h3", {}, "Limite diário e custos"), el("div", { class: "inline", style: "margin-bottom:12px" }, el("label", {}, "Máximo de respostas da IA por dia "),
      el("input", { type: "number", name: "dailyLimit", min: 0, max: 10000, value: settings.dailyLimit })), usageStats()),
  ];
}

function whatsappCard() {
  const status = state.whatsapp;
  const body = [el("h3", {}, "WhatsApp"), el("p", {}, status ? `${status.label} · ${status.connected ? "conectado" : "desconectado"} · ${status.detail ?? ""}` : "Verificando…")];
  if (status?.channel === "waha" && !status.connected) {
    body.push(el("div", { class: "inline", style: "margin-top:10px" },
      el("button", { type: "button", class: "btn", onclick: guarded(connectWaha) }, "Conectar e gerar QR code"),
      el("img", { class: "qr", id: "qr", alt: "QR code para conectar o WhatsApp", hidden: true })));
  }
  if (status?.channel === "oficial") {
    body.push(el("p", { style: "margin-top:10px" }, "URL do webhook para colar no painel da Meta:"), el("code", { class: "url" }, `${location.origin}/webhooks/oficial`));
  }
  if (status?.channel === "simulado") body.push(el("p", { style: "margin-top:8px" }, "Para conectar de verdade, defina WHATSAPP_CHANNEL=oficial ou waha no arquivo .env."));
  return el("div", { class: "panel-card" }, body);
}

async function connectWaha() {
  await api("/api/whatsapp/connect", { method: "POST" });
  toast("Sessão iniciada. Leia o QR code no celular: Dispositivos conectados.");
  const image = $("#qr");
  const refresh = () => { image.hidden = false; image.src = `/api/whatsapp/qr?t=${Date.now()}`; };
  refresh();
  const timer = setInterval(async () => {
    state.whatsapp = await api("/api/whatsapp/status").catch(() => state.whatsapp);
    if (state.whatsapp?.connected || state.tab !== "ajustes") {
      clearInterval(timer);
      renderSettings();
    } else refresh();
  }, 5000);
}

async function renderSettings() {
  const form = $("#settings-form");
  const settings = state.snapshot.settings;
  form.replaceChildren(...settingsCards(settings), whatsappCard(), el("div", { class: "save-bar" }, el("button", { type: "submit", class: "btn" }, "Salvar ajustes")));
  state.whatsapp = await api("/api/whatsapp/status").catch(() => null);
  form.replaceChild(whatsappCard(), form.children[form.children.length - 2]);
}

async function saveSettings(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  state.snapshot.settings = await api("/api/settings", { method: "PUT", body: {
    mode: data.get("mode"), model: data.get("model"), effort: data.get("effort"), dailyLimit: Number(data.get("dailyLimit")),
    testNumbers: String(data.get("testNumbers") ?? "").split(/\n|,/).map((value) => value.trim()).filter(Boolean),
  } });
  toast("Ajustes salvos.");
  await refreshSnapshot();
}

// ---------- ao vivo ----------
let refreshTimer = null;
function scheduleRefresh(conversationId) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(guarded(async () => {
    await refreshSnapshot();
    if (state.activeId && (!conversationId || conversationId === state.activeId)) {
      state.detail = await api(`/api/conversations/${state.activeId}`);
      renderChat();
    }
  }), 250);
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("update", (event) => scheduleRefresh(JSON.parse(event.data).conversationId));
  source.addEventListener("lab", () => { if (state.tab === "laboratorio" && !state.lab.busy) guarded(loadLab)(); });
}

// ---------- início ----------
function bindStaticControls() {
  document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.querySelectorAll("#filters button").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("on", item === button));
    renderList();
  }));
  $("#search").addEventListener("input", (event) => { state.search = event.target.value; renderList(); });
  $("#lab-new").addEventListener("click", () => { state.lab.activeId = null; renderLab(); });
  $("#review-button").addEventListener("click", guarded(reviewWithAi));
  $("#settings-form").addEventListener("submit", guarded(saveSettings));
  $("#simulator").addEventListener("submit", guarded(async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const result = await api("/api/simulator/messages", { method: "POST", body: Object.fromEntries(data) });
    event.target.elements.text.value = "";
    toast(result.routed === "ai" ? "Mensagem recebida. A IA responde depois da pausa." : `Mensagem recebida. ${result.reason ?? ""}`);
  }));
}

async function boot() {
  bindStaticControls();
  await refreshSnapshot();
  const [tab, conversationId] = (location.hash.slice(1) || "conversas").split("/");
  setTab(document.querySelector(`[data-tab="${tab}"]`) ? tab : "conversas", { push: false });
  if (conversationId && state.snapshot.conversations.some((item) => item.id === conversationId)) await openConversation(conversationId);
  guarded(loadLessons)();
  connectEvents();
}

guarded(boot)();
