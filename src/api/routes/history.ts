import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { DEMO_LEARNER } from "../learner.js";
import { historyDto } from "../serializers.js";

const query = z.object({ problemId: z.string().min(1).optional() });

export function historyRoutes(c: Container): Router {
  const r = Router();
  r.get("/", (req, res) => {
    const { problemId } = query.parse(req.query);
    res.json(historyDto(c.practice.history(DEMO_LEARNER, problemId), c.progress.forLearner(DEMO_LEARNER, problemId)));
  });
  return r;
}
