import { describe, expect, it } from "vitest";
import { SqliteJobQueue } from "../src/infra/repositories/sqlite-job-queue.js";
import { LlmError } from "../src/llm/llm-client.js";
import { FakeLlmClient, submitParkingDesign, testContainer, validLlmJson } from "./helpers.js";

describe("EvaluationWorker", () => {
  it("completes a submission and stores feedback", async () => {
    const c = testContainer(new FakeLlmClient(validLlmJson()));
    const { submission } = submitParkingDesign(c);
    expect(c.practice.getSubmission(submission.id).submission.status).toBe("SUBMITTED");

    expect(await c.worker.drain()).toBe(1);
    const view = c.practice.getSubmission(submission.id);
    expect(view.submission.status).toBe("COMPLETED");
    expect(view.feedback?.partial).toBe(false);
    expect(Object.keys(view.feedback!.scores)).toHaveLength(6);
  });

  it("marks FAILED but keeps rule findings as partial feedback when the LLM keeps returning invalid JSON", async () => {
    const llm = new FakeLlmClient("not json", "still not json");
    const c = testContainer(llm);
    // A requirements section missing several keywords, so the rule evaluator has findings to keep.
    const { submission } = submitParkingDesign(c, {
      requirements: "The lot has floors. Vehicles get a ticket when they come in.",
      classes: "- ParkingLot: owns floors\n- Floor: holds spots\n- Ticket: entry time",
      interfaces: "class ParkingLot {\n  park(v: Vehicle): Ticket;\n}\nclass Floor {}\nclass Ticket {}",
      flow: "Vehicle arrives, ParkingLot.park finds a spot on a floor and returns a ticket.",
      tradeoffs: "Kept it simple with three classes rather than more abstractions.",
    });

    await c.worker.drain();
    const view = c.practice.getSubmission(submission.id);
    expect(llm.requests).toHaveLength(2); // first call + exactly one repair
    expect(view.submission.status).toBe("FAILED");
    expect(view.submission.failureReason).toMatch(/invalid after repair retry/);
    expect(view.feedback?.partial).toBe(true);
    expect(view.feedback!.findings.length).toBeGreaterThan(0);
    expect(view.feedback!.findings.every((f) => f.source === "rule")).toBe(true);
  });

  it("times out, retries with backoff, fails; a manual retry then completes", async () => {
    const llm = new FakeLlmClient("hang", "hang", "hang");
    const c = testContainer(llm);
    const { submission } = submitParkingDesign(c);

    await c.worker.drain();
    expect(llm.requests).toHaveLength(3); // 1 call + 2 retries
    let view = c.practice.getSubmission(submission.id);
    expect(view.submission.status).toBe("FAILED");
    expect(view.submission.failureReason).toMatch(/timed out/);

    llm.push(validLlmJson());
    expect(c.practice.retryEvaluation(submission.id).status).toBe("EVALUATING");
    await c.worker.drain();
    view = c.practice.getSubmission(submission.id);
    expect(view.submission.status).toBe("COMPLETED");
    expect(view.submission.failureReason).toBeNull();
    expect(view.feedback?.partial).toBe(false);
  });

  it("does not retry errors that won't fix themselves (e.g. a bad API key)", async () => {
    const llm = new FakeLlmClient(new LlmError("Anthropic returned HTTP 401: invalid x-api-key", false, 401));
    const c = testContainer(llm);
    const { submission } = submitParkingDesign(c);
    await c.worker.drain();
    expect(llm.requests).toHaveLength(1);
    expect(c.practice.getSubmission(submission.id).submission.failureReason).toMatch(/401/);
  });

  it("reclaims a job whose lease expired (worker died mid-evaluation)", async () => {
    const c = testContainer(new FakeLlmClient(validLlmJson()));
    const { submission } = submitParkingDesign(c);

    // Another worker claims the job, moves the submission to EVALUATING, then dies.
    const queue = new SqliteJobQueue(c.db);
    expect(queue.claimNext(c.clock.now(), 60_000)?.submissionId).toBe(submission.id);
    c.db.prepare("UPDATE submissions SET status = 'EVALUATING' WHERE id = ?").run(submission.id);

    expect(await c.worker.drain()).toBe(0); // lease still valid: not claimable
    c.clock.advance(60_001);
    expect(await c.worker.drain()).toBe(1);
    expect(c.practice.getSubmission(submission.id).submission.status).toBe("COMPLETED");
  });

  it("only allows retry from FAILED", async () => {
    const c = testContainer(new FakeLlmClient(validLlmJson()));
    const { submission } = submitParkingDesign(c);
    expect(() => c.practice.retryEvaluation(submission.id)).toThrow("Cannot move a submission from SUBMITTED to EVALUATING");
    await c.worker.drain();
    expect(() => c.practice.retryEvaluation(submission.id)).toThrow("from COMPLETED to EVALUATING");
  });
});

describe("PracticeService.startAttempt", () => {
  it("reuses an attempt with no submissions, and starts v2 (with the change request) after one", () => {
    const c = testContainer(new FakeLlmClient());
    const first = c.practice.startAttempt("demo-learner", "parking-lot");
    const again = c.practice.startAttempt("demo-learner", "parking-lot");
    expect(again).toMatchObject({ created: false });
    expect(again.attempt.id).toBe(first.attempt.id);

    submitParkingDesign(c);
    const v2 = c.practice.startAttempt("demo-learner", "parking-lot");
    expect(v2.created).toBe(true);
    expect(v2.attempt.version).toBe(2);
    expect(v2.attempt.includesChangeRequest).toBe(true);
  });
});
