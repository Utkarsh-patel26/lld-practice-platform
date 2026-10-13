/**
 * The assignment's two change tests, as code. Each adds one new class and one registration line;
 * Attempt, Submission, PracticeService, EvaluationPipeline and EvaluationWorker are used unchanged.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentFormatRegistry,
  type SubmissionContent,
  type ValidationResult,
} from "../src/domain/content/submission-content.js";
import type { EvaluationContext, EvaluationInput, Evaluator, Finding } from "../src/domain/evaluation/evaluator.js";
import { FakeLlmClient, submitParkingDesign, testContainer, validLlmJson } from "./helpers.js";

// ---- Change test A: a class-diagram submission format ----------------------------------------

interface DiagramClass {
  name: string;
  responsibility: string;
  methods: string[];
  implements?: string;
}
interface DiagramData {
  classes: DiagramClass[];
  relations: { from: string; to: string; kind: "uses" | "owns" | "implements" }[];
  notes: string;
}

class FakeDiagramContent implements SubmissionContent {
  readonly format = "class-diagram";
  constructor(private readonly data: DiagramData) {}

  static fromJSON(data: unknown): FakeDiagramContent {
    return new FakeDiagramContent(data as DiagramData);
  }

  validate(): ValidationResult {
    return this.data.classes.length >= 2
      ? { ok: true }
      : { ok: false, errors: [{ field: "classes", message: "A diagram needs at least two classes." }] };
  }

  /** The only diagram-specific logic: map boxes and arrows onto the roles every evaluator reads. */
  toEvaluationInput(): EvaluationInput {
    const code = this.data.classes
      .map((c) => `${c.implements ? "class" : "interface"} ${c.name} {\n${c.methods.map((m) => `  ${m};`).join("\n")}\n}`)
      .join("\n");
    return {
      format: this.format,
      sections: [
        { role: "requirements", title: "Notes", text: this.data.notes, isCode: false },
        { role: "classes", title: "Boxes", text: this.data.classes.map((c) => `- ${c.name}: ${c.responsibility}`).join("\n"), isCode: false },
        { role: "interfaces", title: "Rendered types", text: code, isCode: true },
        { role: "flow", title: "Arrows", text: this.data.relations.map((r) => `${r.from} ${r.kind} ${r.to}`).join("\n"), isCode: false },
        { role: "tradeoffs", title: "Notes", text: this.data.notes, isCode: false },
      ],
    };
  }

  contentHash(): string {
    return createHash("sha256").update(JSON.stringify(this.data)).digest("hex");
  }

  toJSON(): DiagramData {
    return this.data;
  }
}

describe("Change test A: a new submission format", () => {
  it("runs a class diagram through the unchanged practice flow, pipeline and worker", async () => {
    // Added: one SubmissionContent class + one registry line. Nothing else changes.
    const formats = new ContentFormatRegistry().register("class-diagram", FakeDiagramContent.fromJSON);
    const c = testContainer(new FakeLlmClient((req) => validLlmJsonQuoting(req.messages[0]!.content)), { formats });

    const { attempt } = c.practice.startAttempt("demo-learner", "parking-lot");
    const { submission } = c.practice.submit({
      attemptId: attempt.id,
      format: "class-diagram",
      data: {
        notes: "Floors hold spots; a ticket is issued on entry and an hourly fee is charged on exit. Reject entry when full.",
        classes: [
          { name: "PricingStrategy", responsibility: "computes the fee for a ticket", methods: ["fee(ticket: Ticket): number"] },
          { name: "ParkingLot", responsibility: "finds a spot on a floor", methods: ["park(v: Vehicle): Ticket"], implements: "-" },
        ],
        relations: [{ from: "ParkingLot", to: "PricingStrategy", kind: "uses" }],
      } satisfies DiagramData,
    });

    await c.worker.drain();
    const view = c.practice.getSubmission(submission.id);
    expect(view.submission.content.format).toBe("class-diagram");
    expect(view.submission.status).toBe("COMPLETED");
    expect(view.feedback?.findings.some((f) => f.source === "llm")).toBe(true);
  });
});

/** LLM reply that quotes the first line of each section actually present in the prompt. */
function validLlmJsonQuoting(prompt: string): string {
  const firstLine = [...prompt.matchAll(/<section role="\w+"[^>]*>\n(.+)/g)].map((m) => m[1]!.trim())[0]!;
  const out = JSON.parse(validLlmJson()) as { findings: { evidence: string }[] };
  for (const f of out.findings) f.evidence = firstLine;
  return JSON.stringify(out);
}

// ---- Change test B: a human-review evaluator --------------------------------------------------

class FakeHumanEvaluator implements Evaluator {
  readonly source = "human" as const;
  readonly name = "mentor-review";

  async evaluate(ctx: EvaluationContext): Promise<Finding[]> {
    const tradeoffs = ctx.input.sections.find((s) => s.role === "tradeoffs")!.text;
    return [
      {
        criterion: "tradeoff_explanation",
        score: 4,
        evidence: tradeoffs.split(".")[0]!,
        concern: "Mentor: the pricing trade-off is argued with a concrete future change.",
        suggestion: "Also say when the simpler rate table would be the better choice.",
        confidence: 0.9,
        source: "human",
      },
    ];
  }
}

describe("Change test B: a new evaluator", () => {
  it("adds human review to the pipeline without touching the practice flow", async () => {
    // Added: one Evaluator class + one line in the evaluator list. Nothing else changes.
    const c = testContainer(new FakeLlmClient(validLlmJson()), {
      evaluators: (defaults) => [...defaults, new FakeHumanEvaluator()],
    });
    const { submission } = submitParkingDesign(c);
    await c.worker.drain();

    const feedback = c.practice.getSubmission(submission.id).feedback!;
    expect(feedback.props.evaluatedBy).toEqual(["rule-checks", "llm-rubric", "mentor-review"]);
    const human = feedback.findings.filter((f) => f.source === "human");
    expect(human).toHaveLength(1);
    expect(human[0]!.evidence).toBe("PricingStrategy instead of if/else on spot type, because rates change");
  });
});
