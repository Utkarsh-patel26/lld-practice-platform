import { randomUUID } from "node:crypto";
import { ContentFormatRegistry } from "./domain/content/submission-content.js";
import { TEXT_DESIGN_FORMAT, TextDesignContent } from "./domain/content/text-design-content.js";
import type { Evaluator } from "./domain/evaluation/evaluator.js";
import { EvaluationPipeline } from "./domain/evaluation/pipeline.js";
import { consoleLogger, type Logger } from "./domain/logger.js";
import { PracticeService, type Clock } from "./domain/practice-service.js";
import type { ProblemRepository } from "./domain/problem.js";
import { ProgressService } from "./domain/progress.js";
import { EvidenceVerifier } from "./evaluators/evidence-verifier.js";
import { LlmRubricEvaluator } from "./evaluators/llm-rubric-evaluator.js";
import { RuleEvaluator } from "./evaluators/rule-evaluator.js";
import { openDatabase, SqliteTransactionRunner, type Db } from "./infra/db.js";
import { JsonProblemRepository } from "./infra/repositories/json-problem-repository.js";
import { SqliteAttemptRepository } from "./infra/repositories/sqlite-attempt-repository.js";
import { SqliteFeedbackRepository } from "./infra/repositories/sqlite-feedback-repository.js";
import { SqliteJobQueue } from "./infra/repositories/sqlite-job-queue.js";
import { SqliteSubmissionRepository } from "./infra/repositories/sqlite-submission-repository.js";
import type { LlmClient } from "./llm/llm-client.js";
import type { RetryPolicy } from "./llm/retry.js";
import { RubricPrompt } from "./prompts/rubric-prompt.js";
import { EvaluationWorker } from "./worker/evaluation-worker.js";

export interface ContainerOptions {
  readonly dbPath: string;
  readonly llm: LlmClient;
  readonly retry: RetryPolicy;
  readonly leaseMs: number;
  readonly pollMs: number;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly problems?: ProblemRepository;
  /** Extra formats to accept (change test A). */
  readonly formats?: ContentFormatRegistry;
  /** Override the evaluator chain (change test B). Receives the default chain. */
  readonly evaluators?: (defaults: Evaluator[]) => Evaluator[];
}

export interface Container {
  readonly db: Db;
  readonly practice: PracticeService;
  readonly progress: ProgressService;
  readonly worker: EvaluationWorker;
  readonly formats: ContentFormatRegistry;
}

/** Composition root: the only place that knows which implementation sits behind each interface. */
export function createContainer(o: ContainerOptions): Container {
  const clock = o.clock ?? { now: () => new Date() };
  const logger = o.logger ?? consoleLogger;
  const db = openDatabase(o.dbPath);
  const formats = o.formats ?? new ContentFormatRegistry();
  formats.register(TEXT_DESIGN_FORMAT, TextDesignContent.fromJSON);

  const problems = o.problems ?? new JsonProblemRepository();
  const attempts = new SqliteAttemptRepository(db);
  const submissions = new SqliteSubmissionRepository(db, formats);
  const feedback = new SqliteFeedbackRepository(db);
  const queue = new SqliteJobQueue(db);
  const tx = new SqliteTransactionRunner(db);

  const defaults: Evaluator[] = [
    new RuleEvaluator(),
    new LlmRubricEvaluator(o.llm, RubricPrompt.load(), o.retry, logger),
  ];
  const pipeline = new EvaluationPipeline(o.evaluators ? o.evaluators(defaults) : defaults, new EvidenceVerifier(), logger);

  const practice = new PracticeService({
    problems,
    attempts,
    submissions,
    feedback,
    queue,
    tx,
    formats,
    clock,
    newId: randomUUID,
  });
  const progress = new ProgressService(attempts, submissions, feedback);
  const worker = new EvaluationWorker({
    queue,
    submissions,
    attempts,
    problems,
    feedback,
    pipeline,
    tx,
    clock,
    logger,
    leaseMs: o.leaseMs,
    pollMs: o.pollMs,
  });
  return { db, practice, progress, worker, formats };
}
