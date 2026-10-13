import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createApi } from "./api/app.js";
import { loadConfig } from "./config.js";
import { createContainer } from "./container.js";
import { createLlmClient } from "./llm/create-llm-client.js";

const config = loadConfig();
if (config.warning) console.warn(`[warn] ${config.warning}`);

const container = createContainer({
  dbPath: config.dbPath,
  llm: createLlmClient(config.llm),
  retry: { timeoutMs: config.llm.timeoutMs, retries: config.llm.retries, baseDelayMs: config.llm.retryBaseMs },
  leaseMs: config.worker.leaseMs,
  pollMs: config.worker.pollMs,
});

const app = createApi(container, {
  meta: { provider: config.llm.provider, model: config.llm.model, warning: config.warning },
  webDist: fileURLToPath(new URL("../web/dist", import.meta.url)),
});

container.worker.start();
const server = app.listen(config.port, () => {
  console.log(`LLD practice API on http://localhost:${config.port} (evaluator: ${config.llm.provider}/${config.llm.model})`);
});

function shutdown() {
  container.worker.stop();
  server.close(() => {
    container.db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
