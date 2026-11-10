// Painel ao vivo (Server-Sent Events) e conexão do WhatsApp pelo painel.
import { fail, ok, route } from "./router.js";

function streamEvents(runtime, request, response) {
  response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  response.write("retry: 3000\n\n");
  const send = (type) => (payload) => response.write(`event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);
  const onUpdate = send("update");
  const onLab = send("lab");
  runtime.bus.on("update", onUpdate);
  runtime.bus.on("lab", onLab);
  const heartbeat = setInterval(() => response.write(": ping\n\n"), 25_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    runtime.bus.off("update", onUpdate);
    runtime.bus.off("lab", onLab);
  });
}

async function connectWhatsapp(runtime) {
  if (!runtime.channel.connect) return fail(400, "Este canal não precisa de QR code.");
  try {
    const webhookUrl = runtime.config.waha.webhookUrl || `${runtime.config.publicUrl}/webhooks/waha`;
    return ok(await runtime.channel.connect(webhookUrl));
  } catch (error) {
    return fail(502, `Não consegui falar com o WAHA: ${error.message}`);
  }
}

async function qrCode(runtime, response) {
  const image = runtime.channel.qrImage ? await runtime.channel.qrImage().catch(() => null) : null;
  if (!image) return fail(404, "QR code indisponível. Clique em Conectar e aguarde alguns segundos.");
  response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  response.end(image);
  return undefined;
}

export function liveRoutes(runtime) {
  return [
    route("GET", "/api/events", ({ request, response }) => streamEvents(runtime, request, response)),
    route("GET", "/api/whatsapp/status", async () => ok({ channel: runtime.channel.name, label: runtime.channel.label, ...(await runtime.channel.status()) })),
    route("POST", "/api/whatsapp/connect", () => connectWhatsapp(runtime)),
    route("GET", "/api/whatsapp/qr", ({ response }) => qrCode(runtime, response)),
  ];
}
