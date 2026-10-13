import { describe, expect, it } from "vitest";
import { Attempt } from "../src/domain/attempt.js";
import { ContentValidationError } from "../src/domain/content/submission-content.js";
import { TextDesignContent } from "../src/domain/content/text-design-content.js";
import { Feedback } from "../src/domain/evaluation/feedback.js";
import type { Finding } from "../src/domain/evaluation/evaluator.js";
import { ProgressService } from "../src/domain/progress.js";
import { IllegalTransitionError, Submission, type SubmissionStatus } from "../src/domain/submission.js";
import { JsonProblemRepository } from "../src/infra/repositories/json-problem-repository.js";
import { PARKING_DESIGN } from "./helpers.js";

const now = new Date("2026-10-01T10:00:00Z");
const problem = new JsonProblemRepository().get("parking-lot")!;

function submissionIn(status: SubmissionStatus): Submission {
  const s = Submission.create({ id: "s1", attemptId: "a1", content: new TextDesignContent(PARKING_DESIGN), now });
  if (status === "SUBMITTED") return s;
  s.startEvaluation(now);
  if (status === "COMPLETED") s.complete(now);
  if (status === "FAILED") s.fail("boom", now);
  return s;
}

describe("Submission status transitions", () => {
  it("allows SUBMITTED -> EVALUATING -> COMPLETED", () => {
    const s = submissionIn("SUBMITTED");
    s.startEvaluation(now);
    s.complete(now);
    expect(s.status).toBe("COMPLETED");
  });

  it("allows EVALUATING -> FAILED -> EVALUATING (manual retry) and clears the failure reason", () => {
    const s = submissionIn("FAILED");
    expect(s.failureReason).toBe("boom");
    s.startEvaluation(now);
    expect(s.status).toBe("EVALUATING");
    expect(s.failureReason).toBeNull();
  });

  it.each([
    ["COMPLETED", (s: Submission) => s.startEvaluation(now)],
    ["SUBMITTED", (s: Submission) => s.complete(now)],
    ["SUBMITTED", (s: Submission) => s.fail("x", now)],
    ["COMPLETED", (s: Submission) => s.fail("x", now)],
    ["FAILED", (s: Submission) => s.complete(now)],
  ] as const)("rejects an illegal move from %s", (from, move) => {
    const s = submissionIn(from);
    expect(() => move(s)).toThrow(IllegalTransitionError);
    expect(s.status).toBe(from);
  });

  it("derives the idempotency key from attempt id + content hash", () => {
    const a = Submission.idempotencyKeyFor("a1", new TextDesignContent(PARKING_DESIGN));
    const b = Submission.idempotencyKeyFor("a1", new TextDesignContent({ ...PARKING_DESIGN, flow: `  ${PARKING_DESIGN.flow}\r\n` }));
    const c = Submission.idempotencyKeyFor("a1", new TextDesignContent({ ...PARKING_DESIGN, flow: "different flow text here, long enough" }));
    expect(a).toBe(b); // trimming / line endings don't change the hash
    expect(a).not.toBe(c);
    expect(a.startsWith("a1:")).toBe(true);
  });
});

describe("Text design validation", () => {
  it("reports every missing or too-short section", () => {
    const result = new TextDesignContent({ requirements: "too short", classes: PARKING_DESIGN.classes }).validate();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.field)).toEqual(["requirements", "interfaces", "flow", "tradeoffs"]);
    expect(result.errors[0]!.message).toMatch(/too short/);
    expect(result.errors[1]!.message).toMatch(/required/);
  });

  it("never creates a Submission from invalid content", () => {
    expect(() => Submission.create({ id: "s", attemptId: "a", content: new TextDesignContent({}), now })).toThrow(
      ContentValidationError,
    );
  });
});

describe("Attempt", () => {
  it("v1 is graded on the base requirements only", () => {
    const v1 = Attempt.start({ id: "a1", problemId: "parking-lot", learnerId: "l", previousAttempts: 0, now });
    expect(v1.version).toBe(1);
    expect(v1.effectiveRequirements(problem).map((r) => r.id)).not.toContain("CR1");
  });

  it("v2 adds the problem's change request to the effective requirements", () => {
    const v2 = Attempt.start({ id: "a2", problemId: "parking-lot", learnerId: "l", previousAttempts: 1, now });
    const reqs = v2.effectiveRequirements(problem);
    expect(v2.version).toBe(2);
    expect(reqs.at(-1)).toMatchObject({ id: "CR1", fromChangeRequest: true });
    expect(reqs).toHaveLength(problem.requirements.length + 1);
  });
});

const finding = (criterion: Finding["criterion"], score: Finding["score"], confidence = 0.8): Finding => ({
  criterion,
  score,
  evidence: "quoted text",
  concern: "c",
  suggestion: `fix ${criterion}`,
  confidence,
  source: "llm",
});

const feedbackOf = (findings: Finding[]) =>
  Feedback.fromFindings({
    submissionId: "s",
    findings,
    partial: false,
    stoppedEarly: false,
    evaluatedBy: [],
    model: null,
    promptVersion: null,
    droppedFindings: 0,
    createdAt: now,
  });

describe("Feedback scoring", () => {
  it("weights by confidence, ignores low-confidence hints, and picks the weakest confident finding as top fix", () => {
    const fb = feedbackOf([
      finding("extensibility", 4, 0.9),
      finding("extensibility", 2, 0.3), // hint: must not move the score
      finding("edge_cases_state", 2, 0.9),
      finding("edge_cases_state", 3, 0.6),
      finding("tradeoff_explanation", 1, 0.4), // low confidence: no score, not the top fix
    ]);
    expect(fb.scores.extensibility).toBe(4);
    expect(fb.scores.edge_cases_state).toBe(2); // (2*.9 + 3*.6) / 1.5 = 2.4
    expect(fb.scores.tradeoff_explanation).toBeUndefined();
    expect(fb.topFix?.criterion).toBe("edge_cases_state");
  });
});

describe("ProgressService", () => {
  it("returns the weakest dimension across attempts", () => {
    const summary = ProgressService.summarize([
      feedbackOf([finding("edge_cases_state", 2), finding("extensibility", 3), finding("tradeoff_explanation", 3)]),
      feedbackOf([finding("edge_cases_state", 1), finding("extensibility", 2), finding("tradeoff_explanation", 4)]),
      feedbackOf([finding("edge_cases_state", 3), finding("extensibility", 4)]),
    ]);
    expect(summary.attemptsCounted).toBe(3);
    expect(summary.weakest).toMatchObject({ dimension: "edge_cases_state", average: 2, weakIn: 2, scoredIn: 3 });
  });

  it("has no weakest dimension before any feedback exists", () => {
    expect(ProgressService.summarize([]).weakest).toBeNull();
  });
});
