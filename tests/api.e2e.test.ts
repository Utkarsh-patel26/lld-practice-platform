import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/api/app.js";
import { MockLlmClient } from "../src/llm/mock-client.js";
import { FakeLlmClient, PARKING_DESIGN, testContainer, validLlmJson } from "./helpers.js";

const meta = { provider: "test", model: "test", warning: null };

describe("API end-to-end", () => {
  it("create attempt -> submit -> worker -> completed feedback -> history", async () => {
    const c = testContainer(new MockLlmClient());
    const app = createApi(c, { meta });

    const problems = await request(app).get("/api/problems").expect(200);
    expect(problems.body.problems).toHaveLength(4);

    const started = await request(app).post("/api/attempts").send({ problemId: "parking-lot" }).expect(201);
    const attemptId = started.body.attempt.id as string;
    expect(started.body.attempt.version).toBe(1);

    await request(app).put(`/api/attempts/${attemptId}/draft`).send({ draft: { flow: "work in progress" } }).expect(200);

    const submitted = await request(app)
      .post(`/api/attempts/${attemptId}/submissions`)
      .send({ format: "text-design", content: { sections: PARKING_DESIGN } })
      .expect(202);
    const id = submitted.body.submission.id as string;
    expect(submitted.body.submission.status).toBe("SUBMITTED");
    expect(submitted.headers.location).toBe(`/api/submissions/${id}`);

    await c.worker.drain();

    const done = await request(app).get(`/api/submissions/${id}`).expect(200);
    const fb = done.body.submission.feedback;
    expect(done.body.submission.status).toBe("COMPLETED");
    expect(fb.scores).toHaveLength(6);
    expect(fb.topFix).not.toBeNull();
    expect(fb.model).toBe("mock-heuristic-v1");
    expect(fb.promptVersion).toBe("rubric-evaluator.v1");
    // Every quoted finding really is in the submission.
    const text = Object.values(PARKING_DESIGN).join("\n").toLowerCase().replace(/\s+/g, " ");
    for (const f of fb.findings.filter((x: { evidence: string | null }) => x.evidence))
      expect(text).toContain(f.evidence.toLowerCase().replace(/\s+/g, " "));

    const history = await request(app).get("/api/history").expect(200);
    expect(history.body.attempts).toHaveLength(1);
    expect(history.body.attempts[0].latestSubmission.status).toBe("COMPLETED");
    expect(history.body.progress.weakest).not.toBeNull();

    const v2 = await request(app).post("/api/attempts").send({ problemId: "parking-lot" }).expect(201);
    expect(v2.body.attempt.version).toBe(2);
    expect(v2.body.attempt.effectiveRequirements.at(-1).id).toBe("CR1");
  });

  it("rejects an incomplete submission with 400 and per-section messages", async () => {
    const c = testContainer(new FakeLlmClient());
    const app = createApi(c, { meta });
    const { body } = await request(app).post("/api/attempts").send({ problemId: "parking-lot" });
    const res = await request(app)
      .post(`/api/attempts/${body.attempt.id}/submissions`)
      .send({ content: { sections: { ...PARKING_DESIGN, flow: "", tradeoffs: "too short" } } })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details).toEqual([
      { field: "flow", message: "Main use-case flow is required." },
      { field: "tradeoffs", message: expect.stringMatching(/too short \(9 characters, need at least 30\)/) },
    ]);
  });

  it("is idempotent: the same Idempotency-Key returns the same submission with 200", async () => {
    const c = testContainer(new FakeLlmClient(validLlmJson()));
    const app = createApi(c, { meta });
    const { body } = await request(app).post("/api/attempts").send({ problemId: "parking-lot" });
    const send = () =>
      request(app)
        .post(`/api/attempts/${body.attempt.id}/submissions`)
        .set("Idempotency-Key", `${body.attempt.id}:abc123def`)
        .send({ content: { sections: PARKING_DESIGN } });

    const first = await send().expect(202);
    const second = await send().expect(200);
    expect(second.body.submission.id).toBe(first.body.submission.id);
    expect(second.body.duplicate).toBe(true);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM submissions").get()).toEqual({ n: 1 });
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM evaluation_jobs").get()).toEqual({ n: 1 });
  });

  it("uses the consistent error shape for unknown ids, bad input and illegal retries", async () => {
    const c = testContainer(new FakeLlmClient(validLlmJson()));
    const app = createApi(c, { meta });
    expect((await request(app).get("/api/problems/nope").expect(404)).body.error.code).toBe("NOT_FOUND");
    expect((await request(app).post("/api/attempts").send({}).expect(400)).body.error.code).toBe("BAD_REQUEST");

    const { body } = await request(app).post("/api/attempts").send({ problemId: "parking-lot" });
    const sub = await request(app).post(`/api/attempts/${body.attempt.id}/submissions`).send({ content: { sections: PARKING_DESIGN } });
    const retry = await request(app).post(`/api/submissions/${sub.body.submission.id}/retry`).expect(409);
    expect(retry.body.error.code).toBe("ILLEGAL_TRANSITION");
  });
});
