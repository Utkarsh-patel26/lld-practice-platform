import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { DEMO_LEARNER } from "../learner.js";
import { attemptDto, problemDto, submissionDto } from "../serializers.js";

const startBody = z.object({ problemId: z.string().min(1) });
const draftBody = z.object({ draft: z.record(z.string(), z.unknown()) });
const submitBody = z.object({ format: z.string().default("text-design"), content: z.unknown() });
const idempotencyKey = z.string().min(8).max(200).optional();

export function attemptRoutes(c: Container): Router {
  const r = Router();

  r.post("/", (req, res) => {
    const { problemId } = startBody.parse(req.body);
    const { attempt, created } = c.practice.startAttempt(DEMO_LEARNER, problemId);
    res.status(created ? 201 : 200).json({ attempt: attemptDto(attempt, c.practice.getProblem(problemId)) });
  });

  r.get("/:id", (req, res) => {
    const { attempt, problem, submissions } = c.practice.getAttempt(req.params.id);
    res.json({
      attempt: attemptDto(attempt, problem),
      problem: problemDto(problem),
      submissions: submissions.map((s) => submissionDto(s)),
    });
  });

  r.put("/:id/draft", (req, res) => {
    const { draft } = draftBody.parse(req.body);
    const attempt = c.practice.saveDraft(req.params.id, draft);
    res.json({ draftUpdatedAt: attempt.draftUpdatedAt });
  });

  /** 202: stored and queued, evaluation happens later. 200: same idempotency key seen before. */
  r.post("/:id/submissions", (req, res) => {
    const body = submitBody.parse(req.body);
    const { submission, created } = c.practice.submit({
      attemptId: req.params.id,
      format: body.format,
      data: body.content,
      idempotencyKey: idempotencyKey.parse(req.get("Idempotency-Key") || undefined),
    });
    res
      .status(created ? 202 : 200)
      .location(`/api/submissions/${submission.id}`)
      .json({ submission: submissionDto(submission), duplicate: !created });
  });

  return r;
}
