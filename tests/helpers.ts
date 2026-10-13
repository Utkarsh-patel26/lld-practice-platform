import { createContainer, type Container, type ContainerOptions } from "../src/container.js";
import type { Evaluator } from "../src/domain/evaluation/evaluator.js";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "../src/domain/evaluation/rubric.js";
import { silentLogger } from "../src/domain/logger.js";
import type { LlmClient, LlmRequest } from "../src/llm/llm-client.js";

/** One scripted reply: a string, an Error to throw, or "hang" (never resolves; only the timeout ends it). */
export type Scripted = string | Error | "hang" | ((req: LlmRequest) => string);

/** Replays scripted responses in order and records every request it received. */
export class FakeLlmClient implements LlmClient {
  readonly model = "fake-model";
  readonly requests: LlmRequest[] = [];
  private readonly script: Scripted[];

  constructor(...script: Scripted[]) {
    this.script = script;
  }

  push(...more: Scripted[]): void {
    this.script.push(...more);
  }

  async complete(req: LlmRequest): Promise<string> {
    this.requests.push(req);
    const next = this.script.shift();
    if (next === undefined) throw new Error("FakeLlmClient: no scripted response left");
    if (next === "hang") return new Promise<string>(() => {});
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(req) : next;
  }
}

export class TestClock {
  constructor(public t = new Date("2026-10-01T10:00:00Z")) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

/** A reasonable Parking Lot design; mentions every base requirement keyword. */
export const PARKING_DESIGN = {
  requirements:
    "Multiple floors, each with spots for motorcycle, car and truck sizes. A ticket is issued on entry. Hourly fee on exit. Assumption: one vehicle per spot. Show availability per floor. Reject entry when the lot is full.",
  classes:
    "- ParkingLot: owns floors and gates, finds a spot for a vehicle\n- Floor: holds spots and counts available spots per type\n- ParkingSpot: size and occupied flag\n- Ticket: vehicle, spot, entry time\n- PricingStrategy: computes the fee for a ticket",
  interfaces:
    "interface PricingStrategy {\n  fee(ticket: Ticket, exitTime: Date): number;\n}\nclass ParkingLot {\n  park(vehicle: Vehicle): Ticket;\n  exit(ticket: Ticket): Payment;\n}\nclass Floor {\n  findSpot(type: SpotType): ParkingSpot | null;\n}\nclass ParkingSpot {}\nclass Ticket {}",
  flow:
    "Entry: Gate calls ParkingLot.park, which asks each Floor for a free spot of the right SpotType. If none is free, throw LotFullError. Exit: ParkingLot.exit uses PricingStrategy to compute the fee and frees the spot.",
  tradeoffs:
    "PricingStrategy instead of if/else on spot type, because rates change. Alternative: a rate table, rejected because weekend pricing would need code changes.",
};

/** Valid LLM output: one finding per dimension, each quoting real text from PARKING_DESIGN. */
export function validLlmJson(overrides: Partial<Record<RubricDimension, { score?: number; evidence?: string }>> = {}): string {
  const quotes: Record<RubricDimension, string> = {
    requirement_coverage: "A ticket is issued on entry.",
    responsibilities_cohesion: "Floor: holds spots and counts available spots per type",
    coupling_abstraction: "interface PricingStrategy {",
    extensibility: "PricingStrategy instead of if/else on spot type, because rates change.",
    edge_cases_state: "If none is free, throw LotFullError.",
    tradeoff_explanation: "Alternative: a rate table, rejected because weekend pricing would need code changes.",
  };
  return JSON.stringify({
    findings: RUBRIC_DIMENSIONS.map((d) => ({
      criterion: d,
      score: overrides[d]?.score ?? 3,
      evidence: overrides[d]?.evidence ?? quotes[d],
      concern: `Concern about ${d}.`,
      suggestion: `Suggestion for ${d}.`,
      confidence: 0.8,
    })),
  });
}

export function testContainer(
  llm: LlmClient,
  extra: Partial<Omit<ContainerOptions, "llm">> & { evaluators?: (defaults: Evaluator[]) => Evaluator[] } = {},
): Container & { clock: TestClock } {
  const clock = extra.clock instanceof TestClock ? extra.clock : new TestClock();
  const c = createContainer({
    dbPath: ":memory:",
    llm,
    retry: { timeoutMs: 50, retries: 2, baseDelayMs: 1 },
    leaseMs: 60_000,
    pollMs: 1_000,
    logger: silentLogger,
    ...extra,
    clock,
  });
  return { ...c, clock };
}

export function submitParkingDesign(c: Container, sections: Record<string, string> = PARKING_DESIGN) {
  const { attempt } = c.practice.startAttempt("demo-learner", "parking-lot");
  const { submission } = c.practice.submit({ attemptId: attempt.id, format: "text-design", data: { sections } });
  return { attempt, submission };
}
