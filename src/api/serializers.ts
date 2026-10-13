import type { Attempt } from "../domain/attempt.js";
import { CONFIDENCE_THRESHOLD, type Feedback } from "../domain/evaluation/feedback.js";
import { RUBRIC, RUBRIC_DIMENSIONS } from "../domain/evaluation/rubric.js";
import type { HistoryRow } from "../domain/practice-service.js";
import type { Problem } from "../domain/problem.js";
import type { ProgressSummary } from "../domain/progress.js";
import type { Submission } from "../domain/submission.js";

export const problemSummaryDto = (p: Problem) => ({
  id: p.id,
  title: p.title,
  difficulty: p.difficulty,
  summary: p.summary,
});

export const problemDto = (p: Problem) => ({
  ...problemSummaryDto(p),
  description: p.description,
  requirements: p.requirements,
  constraints: p.constraints,
  changeRequest: p.changeRequest,
});

export const attemptDto = (a: Attempt, problem: Problem) => ({
  id: a.id,
  problemId: a.problemId,
  version: a.version,
  includesChangeRequest: a.includesChangeRequest,
  effectiveRequirements: a.effectiveRequirements(problem),
  draft: a.draft,
  draftUpdatedAt: a.draftUpdatedAt,
  createdAt: a.createdAt,
});

export const scoresDto = (f: Feedback | null) =>
  RUBRIC_DIMENSIONS.map((d) => ({ dimension: d, label: RUBRIC[d].label, score: f?.scores[d] ?? null }));

export const feedbackDto = (f: Feedback) => ({
  scores: scoresDto(f),
  topFix: f.topFix && { ...f.topFix, label: RUBRIC[f.topFix.criterion].label },
  findings: f.findings.map((x) => ({
    ...x,
    label: RUBRIC[x.criterion].label,
    worthChecking: x.confidence < CONFIDENCE_THRESHOLD,
  })),
  partial: f.partial,
  stoppedEarly: f.props.stoppedEarly,
  evaluatedBy: f.props.evaluatedBy,
  model: f.props.model,
  promptVersion: f.props.promptVersion,
  droppedFindings: f.props.droppedFindings,
  createdAt: f.props.createdAt,
});

export const submissionDto = (s: Submission, extra?: { feedback: Feedback | null; attempt: Attempt; problem: Problem }) => ({
  id: s.id,
  attemptId: s.attemptId,
  status: s.status,
  failureReason: s.failureReason,
  format: s.content.format,
  content: s.content.toJSON(),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  ...(extra && {
    attempt: { id: extra.attempt.id, version: extra.attempt.version, problemId: extra.problem.id, problemTitle: extra.problem.title },
    feedback: extra.feedback && feedbackDto(extra.feedback),
  }),
});

export const historyDto = (rows: HistoryRow[], progress: ProgressSummary) => ({
  attempts: rows.map((r) => ({
    attemptId: r.attempt.id,
    problemId: r.problem.id,
    problemTitle: r.problem.title,
    version: r.attempt.version,
    createdAt: r.attempt.createdAt,
    latestSubmission: r.latestSubmission && {
      id: r.latestSubmission.id,
      status: r.latestSubmission.status,
      createdAt: r.latestSubmission.createdAt,
      partial: r.feedback?.partial ?? false,
    },
    scores: scoresDto(r.feedback),
  })),
  progress: {
    attemptsCounted: progress.attemptsCounted,
    dimensions: progress.dimensions.map((d) => ({ ...d, label: RUBRIC[d.dimension].label })),
    weakest: progress.weakest && { ...progress.weakest, label: RUBRIC[progress.weakest.dimension].label },
  },
});
