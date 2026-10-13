import { Router } from "express";
import type { Container } from "../../container.js";
import { submissionDto } from "../serializers.js";

export function submissionRoutes(c: Container): Router {
  const r = Router();

  r.get("/:id", (req, res) => {
    const view = c.practice.getSubmission(req.params.id);
    res.json({ submission: submissionDto(view.submission, view) });
  });

  /** Only from FAILED (else 409). Previous partial feedback stays visible until the new run replaces it. */
  r.post("/:id/retry", (req, res) => {
    c.practice.retryEvaluation(req.params.id);
    const view = c.practice.getSubmission(req.params.id);
    res.status(202).json({ submission: submissionDto(view.submission, view) });
  });

  return r;
}
