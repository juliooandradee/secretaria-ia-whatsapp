// Lê os arquivos da pasta clinica/. Editou e salvou: a próxima resposta já usa.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const FILES = { script: "roteiro.md", knowledge: "conhecimento.md", agenda: "agenda.json" };

export function createClinicLoader(clinicDir) {
  let cached = null;
  let signature = "";
  return function loadClinic() {
    const current = Object.values(FILES).map((file) => statSync(path.join(clinicDir, file)).mtimeMs).join(":");
    if (cached && current === signature) return cached;
    const read = (file) => readFileSync(path.join(clinicDir, file), "utf8");
    cached = {
      script: read(FILES.script),
      knowledge: read(FILES.knowledge),
      agenda: JSON.parse(read(FILES.agenda)),
    };
    signature = current;
    return cached;
  };
}

export function automationText(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (values[key] ?? match));
}
