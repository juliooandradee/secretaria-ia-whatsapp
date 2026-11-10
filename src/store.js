// Banco de dados em um arquivo JSON: simples de abrir, copiar e fazer backup.
// Para muitas conversas por dia, troque por PostgreSQL mantendo as mesmas funções.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function emptyState() {
  return {
    version: 1,
    settings: {},
    conversations: {},
    messages: {},
    appointments: [],
    lessons: [],
    usage: {},
    seenExternalIds: [],
    outgoingIndex: {},
    lab: { conversations: {}, appointments: [] },
  };
}

export class JsonStore {
  constructor(filePath = null) {
    this.filePath = filePath;
    this.saveTimer = null;
    this.data = filePath && existsSync(filePath)
      ? { ...emptyState(), ...JSON.parse(readFileSync(filePath, "utf8")) }
      : emptyState();
  }

  get state() {
    return this.data;
  }

  update(mutator) {
    const result = mutator(this.data);
    this.scheduleSave();
    return result;
  }

  scheduleSave() {
    if (!this.filePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 200);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
