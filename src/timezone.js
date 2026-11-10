// Datas sempre no horário da clínica, sem depender do fuso do servidor.
const WEEKDAY_KEYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const formatters = new Map();

function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }));
  }
  return formatters.get(timeZone);
}

export function zonedParts(date, timeZone) {
  const values = Object.fromEntries(partsFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function zoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const wallClockAsUtc = Date.parse(`${parts.date}T${parts.time}:00Z`);
  return wallClockAsUtc - Math.floor(date.getTime() / 60000) * 60000;
}

// "2026-11-12" + "14:30" no horário da clínica → instante exato (Date).
export function zonedTimeToUtc(localDate, localTime, timeZone) {
  const guess = new Date(`${localDate}T${localTime}:00Z`);
  const offset = zoneOffsetMs(guess, timeZone);
  const candidate = new Date(guess.getTime() - offset);
  const corrected = zoneOffsetMs(candidate, timeZone);
  return corrected === offset ? candidate : new Date(guess.getTime() - corrected);
}

export function parseLocalStamp(stamp, timeZone) {
  const match = String(stamp ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/);
  if (!match) return null;
  const date = zonedTimeToUtc(match[1], match[2], timeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localStamp(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.date}T${parts.time}`;
}

export function addDaysToLocalDate(localDate, days) {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayKey(localDate) {
  return WEEKDAY_KEYS[new Date(`${localDate}T12:00:00Z`).getUTCDay()];
}

export function isLocalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

// "quinta-feira, 12/11 às 14h30"
export function formatForPatient(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const [, month, day] = parts.date.split("-");
  const weekday = WEEKDAY_NAMES[new Date(`${parts.date}T12:00:00Z`).getUTCDay()];
  const minutes = parts.minute === 0 ? "" : String(parts.minute).padStart(2, "0");
  return `${weekday}, ${day}/${month} às ${parts.hour}h${minutes}`;
}

export function formatNow(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const weekday = WEEKDAY_NAMES[new Date(`${parts.date}T12:00:00Z`).getUTCDay()];
  return `${weekday}, ${parts.date} ${parts.time}`;
}
