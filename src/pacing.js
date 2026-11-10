// Ritmo humano: espera o paciente terminar de escrever e mostra "digitando..."
// por um tempo proporcional ao tamanho da resposta.

export function createDebouncer(waitMs, onDue) {
  const timers = new Map();
  return {
    schedule(key) {
      clearTimeout(timers.get(key));
      const timer = setTimeout(() => {
        timers.delete(key);
        onDue(key);
      }, waitMs);
      timers.set(key, timer);
    },
    cancel(key) {
      clearTimeout(timers.get(key));
      timers.delete(key);
    },
    isPending(key) {
      return timers.has(key);
    },
    stopAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

export function typingDelayMs(text, { typingMsPerChar, typingMaxMs }, minimumMs = 1500) {
  return Math.min(typingMaxMs, Math.max(minimumMs, String(text).length * typingMsPerChar));
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
