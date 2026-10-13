/**
 * The fixed rubric. Every evaluator (rule, LLM, human) scores against these six dimensions,
 * so feedback is comparable across attempts and does not depend on a reference solution.
 */
export const RUBRIC_DIMENSIONS = [
  "requirement_coverage",
  "responsibilities_cohesion",
  "coupling_abstraction",
  "extensibility",
  "edge_cases_state",
  "tradeoff_explanation",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];
export type Score = 1 | 2 | 3 | 4;

export interface DimensionSpec {
  readonly label: string;
  readonly question: string;
  /** Anchor sentence for each score: 1 missing, 2 weak, 3 solid, 4 strong. */
  readonly anchors: Readonly<Record<Score, string>>;
}

export const RUBRIC: Readonly<Record<RubricDimension, DimensionSpec>> = {
  requirement_coverage: {
    label: "Requirement coverage",
    question: "Does the design handle every stated requirement, and are assumptions explicit?",
    anchors: {
      1: "Most requirements have no class, method or flow step that handles them.",
      2: "Some requirements are handled; at least one core requirement is missing or only named, not designed.",
      3: "Every core requirement maps to a class or method; minor ones may be implicit.",
      4: "Every requirement maps to a named class or method, and ambiguous ones are resolved with stated assumptions.",
    },
  },
  responsibilities_cohesion: {
    label: "Responsibilities & cohesion",
    question: "Does each class own one clear responsibility?",
    anchors: {
      1: "One class (or none) does nearly everything; responsibilities are not stated.",
      2: "Classes exist but at least one mixes unrelated jobs (e.g. pricing, storage and I/O in one place).",
      3: "Each class has one clear job; a few methods sit in a debatable place.",
      4: "Each class has one clear job, behaviour sits with the data it uses, and the split is justified.",
    },
  },
  coupling_abstraction: {
    label: "Coupling & abstraction",
    question: "Do classes depend on abstractions where variation is likely, and on concrete classes elsewhere?",
    anchors: {
      1: "No interfaces or types are defined; everything is one concrete block.",
      2: "Classes depend directly on concrete implementations at points that are likely to vary.",
      3: "Abstractions exist at the main variation points; some coupling remains but is contained.",
      4: "Abstractions sit exactly where variation is expected, with no speculative interfaces.",
    },
  },
  extensibility: {
    label: "Extensibility",
    question:
      "How much existing code must change to add a new variant? On attempt v2+, how well was the change request absorbed?",
    anchors: {
      1: "A new variant (or the change request) needs edits across most classes, or is not handled at all.",
      2: "A new variant needs modified conditionals in several existing classes.",
      3: "A new variant is mostly additive; one or two existing classes change.",
      4: "A new variant (or the change request) is purely additive: new classes plug into existing interfaces.",
    },
  },
  edge_cases_state: {
    label: "Edge cases & state",
    question: "Are invalid inputs, failures and state transitions handled explicitly?",
    anchors: {
      1: "No edge cases or states are considered.",
      2: "One or two edge cases are mentioned but not designed (no state, error or check owns them).",
      3: "Main edge cases are handled and stateful objects have explicit states.",
      4: "Edge cases, illegal transitions and concurrency concerns are designed and owned by specific classes.",
    },
  },
  tradeoff_explanation: {
    label: "Trade-off explanation",
    question: "Does the learner explain why they chose this design over alternatives?",
    anchors: {
      1: "No trade-offs or alternatives are discussed.",
      2: "Alternatives are listed without saying what each costs or gains.",
      3: "At least one real alternative is compared with a concrete reason for the choice.",
      4: "Several choices are justified with costs, and the learner says when they would choose differently.",
    },
  },
};
