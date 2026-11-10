// Servidor HTTP sem framework: rotas, senha do painel, leitura do corpo e arquivos do painel.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeEqual } from "../channels/http.js";
import { logError } from "../log.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const STATIC_FILES = { "/painel": ["index.html", "text/html; charset=utf-8"], "/painel/app.js": ["app.js", "text/javascript; charset=utf-8"], "/painel/style.css": ["style.css", "text/css; charset=utf-8"], "/painel/icon.svg": ["icon.svg", "image/svg+xml"] };
const MAX_BODY_BYTES = 1_000_000;
const failedLogins = new Map();

export function route(method, pattern, handler, options = {}) {
  const regex = new RegExp(`^${pattern.replace(/:\w+/g, "([\\w-]+)")}$`);
  return { method, regex, handler, public: options.public === true };
}

export const ok = (body) => ({ status: 200, body });
export const fail = (status, error) => ({ status, body: { error } });

export function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function tooManyFailures(ip) {
  const now = Date.now();
  const recent = (failedLogins.get(ip) ?? []).filter((stamp) => now - stamp < 10 * 60 * 1000);
  failedLogins.set(ip, recent);
  return recent.length >= 20;
}

function isAuthorized(request, password) {
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return safeEqual(password, decoded.slice(decoded.indexOf(":") + 1));
}

function guardPanel(request, response, password) {
  const ip = request.socket.remoteAddress ?? "local";
  if (tooManyFailures(ip)) {
    sendJson(response, 429, { error: "Muitas tentativas. Espere 10 minutos." });
    return false;
  }
  if (isAuthorized(request, password)) return true;
  if (request.headers.authorization) failedLogins.get(ip).push(Date.now());
  response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Secretaria IA", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
  response.end("Senha do painel necessária (usuário: equipe).");
  return false;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Corpo grande demais."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(rawBody) {
  if (!rawBody.length) return {};
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

function serveStatic(response, pathname) {
  const [file, type] = STATIC_FILES[pathname];
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  response.end(readFileSync(path.join(PUBLIC_DIR, file)));
}

async function dispatch(routes, password, request, response) {
  const url = new URL(request.url, "http://localhost");
  securityHeaders(response);
  if (url.pathname === "/") {
    response.writeHead(302, { Location: "/painel" });
    return response.end();
  }
  const match = routes.find((item) => item.method === request.method && item.regex.test(url.pathname));
  const isStatic = request.method === "GET" && STATIC_FILES[url.pathname];
  if (!match && !isStatic) return sendJson(response, 404, { error: "Não encontrado." });
  if (!match?.public && !guardPanel(request, response, password)) return undefined;
  if (isStatic) return serveStatic(response, url.pathname);
  const rawBody = ["POST", "PUT", "PATCH"].includes(request.method) ? await readBody(request) : Buffer.alloc(0);
  const body = parseJson(rawBody);
  if (body === null) return sendJson(response, 400, { error: "JSON inválido." });
  const params = url.pathname.match(match.regex).slice(1);
  const result = await match.handler({ request, response, url, params, rawBody, body });
  if (result && !response.headersSent) sendJson(response, result.status, result.body);
  return undefined;
}

export function createHttpServer(routes, password) {
  return createServer((request, response) => {
    dispatch(routes, password, request, response).catch((error) => {
      logError("http_failed", error, { method: request.method, path: request.url?.split("?")[0] });
      if (!response.headersSent) sendJson(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : "Erro interno." });
    });
  });
}
