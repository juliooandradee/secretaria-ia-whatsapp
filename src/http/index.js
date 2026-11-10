import { apiRoutes } from "./api.js";
import { liveRoutes } from "./live.js";
import { createHttpServer } from "./router.js";
import { webhookRoutes } from "./webhooks.js";

export function createAppServer(runtime) {
  const routes = [...webhookRoutes(runtime), ...liveRoutes(runtime), ...apiRoutes(runtime)];
  return createHttpServer(routes, runtime.config.panelPassword);
}
