import { findSection, submissionText, type EvaluationContext, type Evaluator, type Finding } from "../domain/evaluation/evaluator.js";

const MAX_QUOTE = 200;
const GOD_CLASS_MIN_METHODS = 8;
const STOPWORDS = new Set(["Note", "Notes", "Assumption", "Assumptions", "Classes", "Entities", "Enums", "Interfaces", "Responsibilities", "Example"]);
const NON_METHODS = new Set(["if", "for", "while", "switch", "catch", "return", "new", "throw", "super", "this", "print", "println", "elif", "with"]);

interface DeclaredType {
  readonly name: string;
  readonly line: string;
  readonly methods: number;
}

/**
 * Deterministic checks: cheap, repeatable and explainable, so they run before (and can veto) the LLM.
 * They are heuristics over text, so most findings carry low confidence and are passed to the LLM as
 * hints to confirm or reject rather than shown as mistakes.
 */
export class RuleEvaluator implements Evaluator {
  readonly source = "rule" as const;
  readonly name = "rule-checks";

  async evaluate(ctx: EvaluationContext): Promise<Finding[]> {
    const code = findSection(ctx.input, "interfaces")?.text ?? "";
    const classes = findSection(ctx.input, "classes")?.text ?? "";
    const declared = parseDeclaredTypes(code);

    if (declared.length === 0)
      return [
        finding({
          criterion: "coupling_abstraction",
          score: 1,
          evidence: firstLine(code),
          concern: "The code section declares no class, interface or enum, so the design's structure can't be assessed.",
          suggestion: "Write the key types as code, e.g. `interface PricingStrategy { ... }` and `class ParkingLot { ... }`.",
          confidence: 0.95,
          blocking: true,
        }),
      ];

    return [
      ...checkListedClassesHaveCode(classes, declared),
      ...checkGodClass(declared),
      ...checkRequirementKeywords(ctx),
    ];
  }
}

function checkListedClassesHaveCode(classesText: string, declared: readonly DeclaredType[]): Finding[] {
  const names = new Set(declared.map((d) => d.name.toLowerCase()));
  const listed = parseListedClasses(classesText);
  const missing = listed.filter((l) => !names.has(l.name.toLowerCase()));
  if (missing.length === 0 || !missing[0]) return [];
  // Only the key types need code, so a few gaps are normal; most classes lacking code is a real signal.
  const mostMissing = missing.length / listed.length > 0.5;
  return [
    finding({
      criterion: "coupling_abstraction",
      score: 2,
      evidence: missing[0].line,
      concern: `${missing.length} of ${listed.length} classes you listed have no declaration in the code section: ${missing
        .slice(0, 5)
        .map((m) => m.name)
        .join(", ")}.`,
      suggestion: "Declare the classes whose interfaces carry the design (the ones others depend on) in the code section.",
      confidence: mostMissing ? 0.55 : 0.35,
    }),
  ];
}

function checkGodClass(declared: readonly DeclaredType[]): Finding[] {
  if (declared.length < 2) return [];
  const counts = declared.map((d) => d.methods).sort((a, b) => a - b);
  const median = counts[Math.floor((counts.length - 1) / 2)] ?? 0;
  const biggest = declared.reduce((a, b) => (b.methods > a.methods ? b : a));
  if (biggest.methods < GOD_CLASS_MIN_METHODS || biggest.methods < 2 * Math.max(median, 1)) return [];
  return [
    finding({
      criterion: "responsibilities_cohesion",
      score: 2,
      evidence: biggest.line,
      concern: `${biggest.name} declares ${biggest.methods} methods while the median type has ${median}; it may own several responsibilities.`,
      suggestion: `Group ${biggest.name}'s methods by the data they use and move each group into its own class.`,
      confidence: 0.6,
    }),
  ];
}

function checkRequirementKeywords(ctx: EvaluationContext): Finding[] {
  const text = submissionText(ctx.input).toLowerCase();
  const mentions = (keywords: readonly string[]) => keywords.some((k) => text.includes(k.toLowerCase()));
  const out: Finding[] = [];
  for (const req of ctx.requirements) {
    if (mentions(req.keywords)) continue;
    if (req.fromChangeRequest)
      out.push(
        finding({
          criterion: "extensibility",
          score: 1,
          evidence: null,
          concern: `Nothing in the submission mentions the change request (${req.id}: "${req.text}"). Looked for: ${req.keywords.join(", ")}.`,
          suggestion: "Show which new classes handle the change request and which existing interfaces they plug into.",
          confidence: 0.6,
        }),
      );
    else
      out.push(
        finding({
          criterion: "requirement_coverage",
          score: 2,
          evidence: null,
          concern: `Possible gap: no mention of requirement ${req.id} ("${req.text}"). Looked for: ${req.keywords.join(", ")}.`,
          suggestion: `Name the class or method that handles ${req.id}, or state the assumption that removes it.`,
          confidence: 0.35,
        }),
      );
  }
  return out;
}

/** Finds `class|interface|enum|struct|record|trait Name` and counts method-like signatures until the next declaration. */
export function parseDeclaredTypes(code: string): DeclaredType[] {
  const lines = code.split("\n");
  const decl = /\b(?:class|interface|enum|struct|record|trait|protocol)\s+([A-Z][A-Za-z0-9_]*)/;
  const method =
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|async|override|virtual|synchronized|def|fun|func|function)\s+)*(?:[\w<>[\],.?]+\s+)?([a-z_][A-Za-z0-9_]*)\s*\(/;
  const types: { name: string; line: string; methods: Set<string> }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const d = decl.exec(line);
    if (d?.[1]) {
      types.push({ name: d[1], line: line.slice(0, MAX_QUOTE), methods: new Set() });
      continue;
    }
    const m = method.exec(line);
    const current = types[types.length - 1];
    if (m?.[1] && current && !NON_METHODS.has(m[1]) && !line.includes("=")) current.methods.add(m[1]);
  }
  return types.map((t) => ({ name: t.name, line: t.line, methods: t.methods.size }));
}

/** Class names at the start of list lines, e.g. "- ParkingLot: owns floors" or "2. **Ticket** - ...". */
export function parseListedClasses(text: string): { name: string; line: string }[] {
  const pattern = /^\s*(?:[-*•]|\d+[.)])?\s*(?:\*\*|`)?([A-Z][A-Za-z0-9_]{2,})(?:\*\*|`)?\s*(?:[:(–—-]|$)/;
  const seen = new Set<string>();
  const out: { name: string; line: string }[] = [];
  for (const raw of text.split("\n")) {
    const name = pattern.exec(raw)?.[1];
    if (!name || STOPWORDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, line: raw.trim().slice(0, MAX_QUOTE) });
  }
  return out;
}

function firstLine(text: string): string | null {
  const line = text.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim().slice(0, MAX_QUOTE) : null;
}

function finding(f: Omit<Finding, "source">): Finding {
  return { ...f, source: "rule" };
}
