import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parseOfficialWebhook, verifySignature, verifySubscription } from "../src/channels/official.js";
import { parseWahaWebhook, verifyWahaSecret } from "../src/channels/waha.js";

const officialPayload = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA_ID",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "5511900000000", phone_number_id: "123" },
        contacts: [{ profile: { name: "Maria Lima" }, wa_id: "551188887777" }],
        messages: [
          { from: "551188887777", id: "wamid.AAA", timestamp: "1794315600", type: "text", text: { body: "Oi, quero marcar" } },
          { from: "551188887777", id: "wamid.BBB", timestamp: "1794315601", type: "image", image: { id: "img", caption: "meu exame" } },
          { from: "551188887777", id: "wamid.CCC", timestamp: "1794315602", type: "reaction", reaction: { message_id: "wamid.X", emoji: "👍" } },
        ],
        statuses: [{ id: "wamid.OUT", status: "read", timestamp: "1794315700", recipient_id: "551188887777" }],
      },
    }],
  }],
};

test("API oficial: lê mensagens, ignora reações e lê status de entrega", () => {
  const { messages, statuses } = parseOfficialWebhook(officialPayload);
  assert.equal(messages.length, 2);
  assert.deepEqual(
    { chatId: messages[0].chatId, name: messages[0].name, text: messages[0].text, kind: messages[0].kind },
    { chatId: "551188887777", name: "Maria Lima", text: "Oi, quero marcar", kind: "text" },
  );
  assert.equal(messages[1].kind, "image");
  assert.equal(messages[1].text, "meu exame");
  assert.deepEqual(statuses, [{ externalId: "wamid.OUT", status: "read", error: null }]);
});

test("API oficial: assinatura e verificação do webhook", () => {
  const raw = Buffer.from(JSON.stringify(officialPayload));
  const signature = `sha256=${createHmac("sha256", "segredo-do-app").update(raw).digest("hex")}`;
  assert.ok(verifySignature(raw, signature, "segredo-do-app"));
  assert.ok(!verifySignature(raw, signature, "outro-segredo"));
  assert.ok(!verifySignature(raw, undefined, "segredo-do-app"));
  const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "token-certo", "hub.challenge": "12345" });
  assert.equal(verifySubscription(query, "token-certo"), "12345");
  assert.equal(verifySubscription(query, "token-errado"), null);
});

test("WAHA: mensagem do paciente, mensagem da equipe pelo celular e grupos ignorados", () => {
  const patient = parseWahaWebhook({ event: "message.any", session: "default", payload: { id: "true_x@c.us_1", from: "5511988887777@c.us", to: "5511900000000@c.us", fromMe: false, body: "Bom dia", hasMedia: false, timestamp: 1794315600, _data: { notifyName: "Maria" } } }, "default");
  assert.equal(patient.messages[0].phone, "5511988887777");
  assert.equal(patient.messages[0].name, "Maria");
  const team = parseWahaWebhook({ event: "message.any", session: "default", payload: { id: "true_y", from: "5511900000000@c.us", to: "5511988887777@c.us", fromMe: true, body: "Oi, Maria!", timestamp: 1794315601 } }, "default");
  assert.equal(team.messages[0].chatId, "5511988887777@c.us");
  assert.equal(team.messages[0].fromMe, true);
  const group = parseWahaWebhook({ event: "message.any", session: "default", payload: { id: "g1", from: "120363@g.us", fromMe: false, body: "oi" } }, "default");
  assert.equal(group.messages.length, 0);
  const lid = parseWahaWebhook({ event: "message.any", session: "default", payload: { id: "l1", from: "987654321@lid", fromMe: false, body: "oi" } }, "default");
  assert.equal(lid.messages[0].phone, null, "@lid precisa ser resolvido no WAHA");
  const otherSession = parseWahaWebhook({ event: "message.any", session: "outra", payload: { id: "z", from: "5511988887777@c.us", body: "oi" } }, "default");
  assert.equal(otherSession.messages.length, 0);
  const ack = parseWahaWebhook({ event: "message.ack", session: "default", payload: { id: "true_y", ack: 3 } }, "default");
  assert.deepEqual(ack.statuses, [{ externalId: "true_y", status: "read", error: null }]);
  assert.ok(verifyWahaSecret("um-segredo-longo-de-teste-123", "um-segredo-longo-de-teste-123"));
  assert.ok(!verifyWahaSecret("errado", "um-segredo-longo-de-teste-123"));
});
