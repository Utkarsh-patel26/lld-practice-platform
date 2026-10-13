import type { Finding } from "./evaluator.js";
import { RUBRIC_DIMENSIONS, type RubricDimension, type Score } from "./rubric.js";

/** Findings below this confidence are shown as "worth checking" and do not move scores. */
export const CONFIDENCE_THRESHOLD = 0.5;

export type DimensionScores = Partial<Record<RubricDimension, Score>>;

export interface TopFix {
  readonly criterion: RubricDimension;
  readonly suggestion: string;
  readonly evidence: string | null;
}

export interface FeedbackProps {
  readonly submissionId: string;
  readonly scores: DimensionScores;
  readonly findings: readonly Finding[];
  readonly topFix: TopFix | null;
  /** True when an evaluator failed and only earlier findings (e.g. rule checks) are available. */
  readonly partial: boolean;
  /** True when a blocking rule finding stopped the pipeline before later evaluators ran. */
  readonly stoppedEarly: boolean;
  readonly evaluatedBy: readonly string[];
  readonly model: string | null;
  readonly promptVersion: string | null;
  /** Findings removed because their quoted evidence was not in the submission. */
  readonly droppedFindings: number;
  readonly createdAt: Date;
}

/** The result of evaluating one Submission: a 1-4 score per dimension, the evidence behind it, and one fix to do next. */
export class Feedback {
  private constructor(readonly props: FeedbackProps) {}

  static restore(props: FeedbackProps): Feedback {
    return new Feedback(props);
  }

  static fromFindings(args: Omit<FeedbackProps, "scores" | "topFix">): Feedback {
    const scores = Feedback.scoreDimensions(args.findings);
    return new Feedback({ ...args, scores, topFix: Feedback.pickTopFix(args.findings, scores) });
  }

  get submissionId(): string {
    return this.props.submissionId;
  }
  get scores(): DimensionScores {
    return this.props.scores;
  }
  get findings(): readonly Finding[] {
    return this.props.findings;
  }
  get topFix(): TopFix | null {
    return this.props.topFix;
  }
  get partial(): boolean {
    return this.props.partial;
  }

  /**
   * Score per dimension = confidence-weighted mean of its confident findings, rounded to 1-4.
   * A dimension with only low-confidence hints stays unscored rather than guessed.
   */
  static scoreDimensions(findings: readonly Finding[]): DimensionScores {
    const scores: DimensionScores = {};
    for (const dim of RUBRIC_DIMENSIONS) {
      const confident = findings.filter((f) => f.criterion === dim && f.confidence >= CONFIDENCE_THRESHOLD);
      if (confident.length === 0) continue;
      const weight = confident.reduce((sum, f) => sum + f.confidence, 0);
      const mean = confident.reduce((sum, f) => sum + f.score * f.confidence, 0) / weight;
      scores[dim] = Math.min(4, Math.max(1, Math.round(mean))) as Score;
    }
    return scores;
  }

  /**
   * Picked by code, not by the LLM, so the top fix always points at a finding whose quote was verified.
   * Order: a blocking finding; else the lowest-scored confident finding, tie-broken by its dimension's
   * score, then by confidence, then by rubric order.
   */
  static pickTopFix(findings: readonly Finding[], scores: DimensionScores): TopFix | null {
    const blocking = findings.find((f) => f.blocking);
    const candidates = blocking ? [blocking] : findings.filter((f) => f.confidence >= CONFIDENCE_THRESHOLD);
    const best = [...candidates].sort(
      (a, b) =>
        a.score - b.score ||
        (scores[a.criterion] ?? 4) - (scores[b.criterion] ?? 4) ||
        b.confidence - a.confidence ||
        RUBRIC_DIMENSIONS.indexOf(a.criterion) - RUBRIC_DIMENSIONS.indexOf(b.criterion),
    )[0];
    if (!best || (!blocking && best.score >= 4)) return null;
    return { criterion: best.criterion, suggestion: best.suggestion, evidence: best.evidence };
  }
}

export interface FeedbackRepository {
  get(submissionId: string): Feedback | undefined;
  /** One Feedback per Submission: saving again (after a retry) replaces it. */
  save(feedback: Feedback): void;
}
