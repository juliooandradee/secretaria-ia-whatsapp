// Telefones do WhatsApp no Brasil chegam com ou sem o 9º dígito (contas antigas).
// Comparamos as duas formas para não perder um paciente da lista de teste.

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function phoneVariants(phone) {
  const digits = digitsOnly(phone);
  if (!digits) return [];
  const variants = new Set([digits]);
  const brazilMobile = digits.match(/^55(\d{2})(9?)(\d{8})$/);
  if (brazilMobile && /^[6-9]/.test(brazilMobile[3])) {
    const [, areaCode, , localNumber] = brazilMobile;
    variants.add(`55${areaCode}9${localNumber}`);
    variants.add(`55${areaCode}${localNumber}`);
  }
  return [...variants];
}

export function samePhone(first, second) {
  const firstVariants = phoneVariants(first);
  if (firstVariants.length === 0) return false;
  return phoneVariants(second).some((variant) => firstVariants.includes(variant));
}

export function maskPhone(phone) {
  const digits = digitsOnly(phone);
  return digits ? `final ${digits.slice(-4)}` : "sem número";
}

// "5511999998888@c.us" → "5511999998888". Identificadores "@lid" não são telefone.
export function phoneFromChatId(chatId) {
  const match = String(chatId ?? "").match(/^(\d{8,15})@(c\.us|s\.whatsapp\.net)$/);
  return match ? match[1] : null;
}
