import type { RubricDimension, Score } from "../domain/evaluation/rubric.js";
import type { LlmClient, LlmRequest } from "./llm-client.js";

interface MockFinding {
  criterion: RubricDimension;
  score: Score;
  evidence: string;
  concern: string;
  suggestion: string;
  confidence: number;
}

/**
 * Deterministic stand-in for a real model, so the app runs end-to-end with no API key.
 * It parses the same prompt a real model receives and returns JSON in the same schema, quoting real
 * lines from the submission, so mock mode exercises prompt building, zod validation and evidence checks.
 * Its judgement is keyword counting: good enough to demo the loop, not to grade a design.
 */
export class MockLlmClient implements LlmClient {
  readonly model = "mock-heuristic-v1";

  constructor(private readonly latencyMs = 0) {}

  async complete(req: LlmRequest): Promise<string> {
    if (this.latencyMs > 0) await delay(this.latencyMs, req.signal);
    const prompt = req.messages.filter((m) => m.role === "user").map((m) => m.content)[0] ?? "";
    return JSON.stringify({ findings: evaluate(prompt) });
  }
}

function evaluate(prompt: string): MockFinding[] {
  const sections = new Map<string, string[]>();
  for (const m of prompt.matchAll(/<section role="(\w+)"[^>]*>\n([\s\S]*?)\n<\/section>/g))
    sections.set(m[1]!, sentences(m[2]!));
  const lines = (role: string) => sections.get(role) ?? [];
  const all = [...sections.values()].flat();
  const first = (role: string) => lines(role)[0] ?? all[0] ?? "";
  const match = (pool: string[], re: RegExp) => pool.filter((l) => re.test(l));
  const hints = [...prompt.matchAll(/<hint id="(H\d+)" dimension="(\w+)"/g)].map((m) => ({ id: m[1]!, dim: m[2]! }));
  const isV2 = /from_change_request="true"/.test(prompt);
  const out: MockFinding[] = [];

  // requirement_coverage: driven by the rule checker's keyword gaps.
  const gaps = hints.filter((h) => h.dim === "requirement_coverage");
  const assumption = match(lines("requirements"), /assum/i)[0];
  out.push({
    criterion: "requirement_coverage",
    score: gaps.length === 0 ? (assumption ? 4 : 3) : gaps.length <= 2 ? 2 : 1,
    evidence: assumption ?? first("requirements"),
    concern:
      gaps.length === 0
        ? "Every requirement is mentioned somewhere in the design."
        : `Hint ${gaps.map((g) => g.id).join(", ")} confirmed: ${gaps.length} requirement(s) are not visibly handled.`,
    suggestion:
      gaps.length === 0
        ? "Map each requirement id to the class or method that handles it, so a reviewer can trace it."
        : "For each missing requirement, name the class and method that owns it.",
    confidence: 0.7,
  });

  // responsibilities_cohesion: the longest responsibility line is the likeliest to mix jobs.
  const classLines = lines("classes");
  const longest = classLines.reduce((a, b) => (b.length > a.length ? b : a), classLines[0] ?? first("classes"));
  const jobs = (longest.match(/,| and /g) ?? []).length + 1;
  out.push({
    criterion: "responsibilities_cohesion",
    score: jobs >= 4 ? 2 : classLines.length >= 4 ? 3 : 2,
    evidence: longest,
    concern:
      jobs >= 4
        ? `This class appears to own about ${jobs} different jobs.`
        : "Responsibilities are split across classes, each with a short description.",
    suggestion:
      jobs >= 4
        ? "Split it so each class has one reason to change."
        : "State for each class what it must NOT do, to make the boundaries explicit.",
    confidence: 0.7,
  });

  // coupling_abstraction: are there abstractions in the code at all?
  const abstractions = match(lines("interfaces"), /\b(interface|abstract class|trait|protocol)\b/i);
  out.push({
    criterion: "coupling_abstraction",
    score: abstractions.length >= 3 ? 4 : abstractions.length >= 1 ? 3 : 2,
    evidence: abstractions[0] ?? first("interfaces"),
    concern:
      abstractions.length > 0
        ? `${abstractions.length} abstraction(s) are declared; check each sits where behaviour really varies.`
        : "Only concrete classes are declared, so callers depend on implementations.",
    suggestion:
      abstractions.length > 0
        ? "For each interface, name the second implementation you expect; drop interfaces with none."
        : "Introduce an interface at the point most likely to vary (pricing, dispatch, payment) and inject it.",
    confidence: 0.7,
  });

  // extensibility: on v2, did the change request land behind an abstraction?
  const crMissing = hints.some((h) => h.dim === "extensibility");
  const pluggable = match([...lines("interfaces"), ...lines("classes")], /strategy|policy|factory|interface|plugin|handler/i)[0];
  out.push({
    criterion: "extensibility",
    score: crMissing ? 1 : pluggable ? 3 : 2,
    evidence: pluggable ?? first("interfaces"),
    concern: crMissing
      ? "The change request is not handled anywhere in the design."
      : pluggable
        ? isV2
          ? "The change appears to plug into an existing abstraction rather than editing existing classes."
          : "There is an extension point, so a new variant can be added as a new class."
        : "No extension point is visible; a new variant would mean editing existing classes.",
    suggestion: crMissing
      ? "Add the classes the change request needs and show which existing interface they implement."
      : "Walk through adding one more variant and list every existing file you would have to edit.",
    confidence: 0.7,
  });

  // edge_cases_state: how many lines talk about failures and states?
  const edgy = match(
    [...lines("flow"), ...lines("requirements"), ...lines("interfaces")],
    /invalid|error|exception|fail|full|empty|out of stock|insufficient|cancel|refund|timeout|concurren|lock|state|status|enum/i,
  );
  out.push({
    criterion: "edge_cases_state",
    score: edgy.length >= 7 ? 4 : edgy.length >= 4 ? 3 : edgy.length >= 1 ? 2 : 1,
    evidence: edgy[0] ?? first("flow"),
    concern:
      edgy.length >= 4
        ? `${edgy.length} lines deal with failures or states.`
        : "Few failure cases or states are designed; the flow mostly covers the happy path.",
    suggestion: "List the states of your main stateful object and which method moves it between them, including the failure path.",
    confidence: 0.7,
  });

  // tradeoff_explanation: does the learner justify choices?
  const reasons = match(lines("tradeoffs"), /because|instead|rather than|\bvs\.?\b|versus|trade-?off|alternative|cost|simpler|downside/i);
  out.push({
    criterion: "tradeoff_explanation",
    score: reasons.length >= 4 ? 4 : reasons.length >= 2 ? 3 : 2,
    evidence: reasons[0] ?? first("tradeoffs"),
    concern:
      reasons.length >= 2
        ? `${reasons.length} choices are justified against an alternative.`
        : "Choices are stated but rarely compared with an alternative.",
    suggestion: "For your biggest decision, name the alternative, what it would cost, and when you'd switch to it.",
    confidence: 0.7,
  });

  return out;
}

/** Quotable units: lines split into sentences, 8-200 chars, so every quote is short and verbatim. */
function sentences(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.trim().split(/(?<=[.!?;])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 200);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}
