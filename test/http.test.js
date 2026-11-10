import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { createAppServer } from "../src/http/index.js";
import { testRuntime } from "./helpers.js";

const PASSWORD = "senha-de-teste-bem-longa";
const auth = { Authorization: `Basic ${Buffer.from(`equipe:${PASSWORD}`).toString("base64")}` };
let server;
let base;
let official;

before(async () => {
  official = testRuntime({ env: { WHATSAPP_CHANNEL: "oficial", META_APP_SECRET: "app-secret", META_VERIFY_TOKEN: "verify-token", META_ACCESS_TOKEN: "x", META_PHONE_NUMBER_ID: "1" }, channel: { name: "oficial", label: "API oficial", sendText: async () => ({ externalId: "wamid.OUT" }), markReadAndTyping: async () => {}, status: async () => ({ connected: true }) } });
  server = createAppServer(official.runtime);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  official.runtime.debouncer.stopAll();
  server.close();
});

test("painel exige senha e envia cabeçalhos de segurança", async () => {
  const denied = await fetch(`${base}/api/state`);
  assert.equal(denied.status, 401);
  const wrong = await fetch(`${base}/api/state`, { headers: { Authorization: `Basic ${Buffer.from("equipe:errada").toString("base64")}` } });
  assert.equal(wrong.status, 401);
  const allowed = await fetch(`${base}/api/state`, { headers: auth });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("x-frame-options"), "DENY");
  const body = await allowed.json();
  assert.equal(body.settings.mode, "live");
  const page = await fetch(`${base}/painel`, { headers: auth });
  assert.match(await page.text(), /Secretária IA/);
});

test("webhook oficial: verificação, assinatura e mensagem recebida", async () => {
  const verify = await fetch(`${base}/webhooks/oficial?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=4242`);
  assert.equal(await verify.text(), "4242");
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "5511988887777", profile: { name: "Maria" } }], messages: [{ from: "5511988887777", id: "wamid.IN1", timestamp: "1794315600", type: "text", text: { body: "Oi" } }] } }] }] });
  const unsigned = await fetch(`${base}/webhooks/oficial`, { method: "POST", body: payload, headers: { "Content-Type": "application/json" } });
  assert.equal(unsigned.status, 401);
  const signature = `sha256=${createHmac("sha256", "app-secret").update(payload).digest("hex")}`;
  const signed = await fetch(`${base}/webhooks/oficial`, { method: "POST", body: payload, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature } });
  assert.equal(signed.status, 200);
  assert.deepEqual(await signed.json(), { received: 1, statuses: 0 });
  const repeated = await fetch(`${base}/webhooks/oficial`, { method: "POST", body: payload, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature } });
  assert.equal(repeated.status, 200);
  const state = await (await fetch(`${base}/api/state`, { headers: auth })).json();
  assert.equal(state.conversations.length, 1, "webhook repetido não duplica");
  assert.equal(state.conversations[0].name, "Maria");
});

test("ajustes inválidos voltam com erro claro", async () => {
  const response = await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "turbo" }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Modo inválido/);
});
