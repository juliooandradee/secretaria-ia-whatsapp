import { createOfficialChannel } from "./official.js";
import { createSimulatedChannel } from "./simulated.js";
import { createWahaChannel } from "./waha.js";

export function createChannel(config) {
  if (config.channel === "oficial") return createOfficialChannel(config);
  if (config.channel === "waha") return createWahaChannel(config);
  return createSimulatedChannel();
}
