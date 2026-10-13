import type { AttemptRepository } from "./attempt.js";
import type { Feedback, FeedbackRepository } from "./evaluation/feedback.js";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "./evaluation/rubric.js";
import type { SubmissionRepository } from "./submission.js";

export interface DimensionProgress {
  readonly dimension: RubricDimension;
  readonly average: number;
  /** In how many of the counted attempts this dimension scored 1 or 2. */
  readonly weakIn: number;
  readonly scoredIn: number;
}

export interface ProgressSummary {
  readonly attemptsCounted: number;
  readonly dimensions: readonly DimensionProgress[];
  readonly weakest: DimensionProgress | null;
}

/** Answers "what do I keep getting wrong?" across attempts, which no single feedback can. */
export class ProgressService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly submissions: SubmissionRepository,
    private readonly feedback: FeedbackRepository,
  ) {}

  /** Uses each attempt's latest COMPLETED feedback, so resubmitting within one attempt doesn't over-count it. */
  forLearner(learnerId: string, problemId?: string): ProgressSummary {
    const latest: Feedback[] = [];
    for (const attempt of this.attempts.listByLearner(learnerId, problemId)) {
      const completed = this.submissions
        .listByAttempt(attempt.id)
        .filter((s) => s.status === "COMPLETED")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const fb = completed && this.feedback.get(completed.id);
      if (fb) latest.push(fb);
    }
    return ProgressService.summarize(latest);
  }

  /** Weakest = lowest average score; ties go to the dimension that was weak more often, then rubric order. */
  static summarize(feedbacks: readonly Feedback[]): ProgressSummary {
    const dimensions: DimensionProgress[] = [];
    for (const dimension of RUBRIC_DIMENSIONS) {
      const scores = feedbacks.map((f) => f.scores[dimension]).filter((s): s is NonNullable<typeof s> => s !== undefined);
      if (scores.length === 0) continue;
      dimensions.push({
        dimension,
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
        weakIn: scores.filter((s) => s <= 2).length,
        scoredIn: scores.length,
      });
    }
    const weakest = [...dimensions].sort((a, b) => a.average - b.average || b.weakIn - a.weakIn)[0] ?? null;
    return { attemptsCounted: feedbacks.length, dimensions, weakest };
  }
}
