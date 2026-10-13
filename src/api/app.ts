import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Container } from "../container.js";
import { errorHandler } from "./errors.js";
import { DEMO_LEARNER } from "./learner.js";
import { attemptRoutes } from "./routes/attempts.js";
import { historyRoutes } from "./routes/history.js";
import { problemRoutes } from "./routes/problems.js";
import { submissionRoutes } from "./routes/submissions.js";

export interface ApiOptions {
  readonly meta: { provider: string; model: string; warning: string | null };
  /** Built React app to serve in production mode; omitted in dev (Vite serves it) and in tests. */
  readonly webDist?: string;
}

export function createApi(c: Container, options: ApiOptions): Express {
  const app = express();
  app.use(express.json({ limit: "200kb" }));

  app.get("/api/meta", (_req, res) => {
    res.json({ ...options.meta, learnerId: DEMO_LEARNER });
  });
  app.use("/api/problems", problemRoutes(c));
  app.use("/api/attempts", attemptRoutes(c));
  app.use("/api/submissions", submissionRoutes(c));
  app.use("/api/history", historyRoutes(c));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } });
  });

  if (options.webDist && existsSync(options.webDist)) {
    const dist = options.webDist;
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) => res.sendFile(join(dist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
