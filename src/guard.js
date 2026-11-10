// Proteções que rodam ANTES de gastar tokens.
// O detector é conservador: as regras do roteiro continuam valendo para o resto.

const INJECTION_PATTERNS = [
  /ignor(e|a|ar)\s+(todas\s+)?(as\s+)?(suas\s+)?(instru[çc][õo]es|regras|ordens)/i,
  /esque[çc](a|er)\s+(todas\s+)?(as\s+)?(suas\s+)?(instru[çc][õo]es|regras)/i,
  /(mostre|revele|exiba|imprima|repita|me\s+passe)\s+(o\s+|seu\s+|suas\s+|as\s+)?(prompt|instru[çc][õo]es|regras\s+internas)/i,
  /\b(system\s*prompt|prompt\s+do\s+sistema|developer\s+mode|modo\s+(desenvolvedor|deus)|jailbreak)\b/i,
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+(instructions|rules)/i,
  /\b(sou|aqui\s+[ée])\s+(o\s+|a\s+)?(administrador|admin|desenvolvedor)\s+(do\s+sistema|da\s+ia|do\s+bot)/i,
  /a\s+partir\s+de\s+agora\s+voc[êe]\s+(é|vai\s+ser|ser[áa])\s+/i,
];

const EMERGENCY_PATTERNS = [
  /dor\s+(muito\s+)?(forte\s+)?no\s+peito/i,
  /aperto\s+no\s+peito/i,
  /falta\s+de\s+ar/i,
  /n[ãa]o\s+(consigo|estou\s+conseguindo)\s+respirar/i,
  /desmai/i,
  /convuls/i,
  /sangr(amento|ando)\s+(muito|forte|intenso|sem\s+parar)/i,
  /perd(i|endo|eu)\s+(a\s+)?vis[ãa]o/i,
  /(parei|deixei)\s+de\s+enxergar/i,
  /suic[ií]d/i,
  /(me|vou\s+me)\s+matar/i,
  /tirar\s+(a\s+)?minha\s+(pr[óo]pria\s+)?vida/i,
  /\b(infarto|avc|derrame)\b/i,
  /(boca|rosto)\s+torto/i,
];

export const INJECTION_REPLY = "Por aqui eu ajudo com agendamentos e informações da clínica. Como posso te ajudar?";

export const EMERGENCY_REPLY = "Isso pode ser uma emergência. Ligue agora para o SAMU (192) ou vá ao pronto-socorro mais próximo. Já avisei a equipe da clínica para acompanhar você.";

export function detectPromptInjection(text) {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(String(text ?? "")));
}

export function detectEmergency(text) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(String(text ?? "")));
}

// Duas tentativas em 15 minutos tiram a IA da conversa e chamam a equipe.
export function registerStrike(previousStrikes, now, windowMs = 15 * 60 * 1000) {
  const recent = previousStrikes.filter((stamp) => now.getTime() - Date.parse(stamp) < windowMs);
  recent.push(now.toISOString());
  return { strikes: recent, shouldPause: recent.length >= 2 };
}
