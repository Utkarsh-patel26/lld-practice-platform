// Thin typed client for the Express API. Types mirror src/api/serializers.ts.

export type Dimension =
  | "requirement_coverage"
  | "responsibilities_cohesion"
  | "coupling_abstraction"
  | "extensibility"
  | "edge_cases_state"
  | "tradeoff_explanation";
export type Status = "SUBMITTED" | "EVALUATING" | "COMPLETED" | "FAILED";

export interface Requirement {
  id: string;
  text: string;
  fromChangeRequest?: boolean;
}
export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string;
  summary: string;
}
export interface Problem extends ProblemSummary {
  description: string;
  requirements: Requirement[];
  constraints: string[];
  changeRequest: { id: string; title: string; text: string };
}
export interface Attempt {
  id: string;
  problemId: string;
  version: number;
  includesChangeRequest: boolean;
  effectiveRequirements: Requirement[];
  draft: Record<string, unknown>;
  draftUpdatedAt: string | null;
  createdAt: string;
}
export interface ScoreRow {
  dimension: Dimension;
  label: string;
  score: number | null;
}
export interface Finding {
  criterion: Dimension;
  label: string;
  score: number;
  evidence: string | null;
  concern: string;
  suggestion: string;
  confidence: number;
  source: "rule" | "llm" | "human";
  worthChecking: boolean;
  blocking?: boolean;
}
export interface Feedback {
  scores: ScoreRow[];
  topFix: { criterion: Dimension; label: string; suggestion: string; evidence: string | null } | null;
  findings: Finding[];
  partial: boolean;
  stoppedEarly: boolean;
  evaluatedBy: string[];
  model: string | null;
  promptVersion: string | null;
  droppedFindings: number;
}
export interface Submission {
  id: string;
  attemptId: string;
  status: Status;
  failureReason: string | null;
  content: { sections?: Record<string, string> };
  createdAt: string;
  attempt?: { id: string; version: number; problemId: string; problemTitle: string };
  feedback?: Feedback | null;
}
export interface HistoryResponse {
  attempts: {
    attemptId: string;
    problemId: string;
    problemTitle: string;
    version: number;
    createdAt: string;
    latestSubmission: { id: string; status: Status; createdAt: string; partial: boolean } | null;
    scores: ScoreRow[];
  }[];
  progress: {
    attemptsCounted: number;
    weakest: { dimension: Dimension; label: string; average: number; weakIn: number; scoredIn: number } | null;
  };
}
export interface Meta {
  provider: string;
  model: string;
  warning: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const api = {
  meta: () => call<Meta>("GET", "/meta"),
  problems: () => call<{ problems: ProblemSummary[] }>("GET", "/problems"),
  startAttempt: (problemId: string) => call<{ attempt: Attempt }>("POST", "/attempts", { problemId }),
  attempt: (id: string) => call<{ attempt: Attempt; problem: Problem; submissions: Submission[] }>("GET", `/attempts/${id}`),
  saveDraft: (id: string, draft: Record<string, string>) =>
    call<{ draftUpdatedAt: string }>("PUT", `/attempts/${id}/draft`, { draft }),
  submit: (attemptId: string, sections: Record<string, string>, idempotencyKey: string) =>
    call<{ submission: Submission; duplicate: boolean }>(
      "POST",
      `/attempts/${attemptId}/submissions`,
      { format: "text-design", content: { sections } },
      { "Idempotency-Key": idempotencyKey },
    ),
  submission: (id: string) => call<{ submission: Submission }>("GET", `/submissions/${id}`),
  retry: (id: string) => call<{ submission: Submission }>("POST", `/submissions/${id}/retry`),
  history: (problemId?: string) =>
    call<HistoryResponse>("GET", `/history${problemId ? `?problemId=${encodeURIComponent(problemId)}` : ""}`),
};

/** Same canonical form as TextDesignContent.contentHash on the server, so keys match across clients. */
export async function idempotencyKey(attemptId: string, order: string[], sections: Record<string, string>): Promise<string> {
  const canonical = JSON.stringify(order.map((k) => (sections[k] ?? "").replace(/\r\n/g, "\n").trim()));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${attemptId}:${hex}`;
}
