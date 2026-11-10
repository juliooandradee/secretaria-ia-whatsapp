import { createHash, randomBytes } from "node:crypto";

export function newId(prefix) {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${prefix}_${digest.slice(0, 12)}`;
}
