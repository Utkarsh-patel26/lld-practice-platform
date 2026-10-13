import { useEffect, useState } from "react";
import { api, type Dimension, type Feedback, type Finding, type Status, type Submission } from "../api";
import { navigate } from "../router";

const STEPS: Status[] = ["SUBMITTED", "EVALUATING", "COMPLETED"];
const POLL_MS = 3000;

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status.toLowerCase()}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="muted small">not scored</span>;
  return (
    <span className="scorebar" role="img" aria-label={`${score} out of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= score ? `seg on s${score}` : "seg"} />
      ))}
      <span className="score-num">{score}/4</span>
    </span>
  );
}

export function SubmissionPage({ submissionId }: { submissionId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const load = () =>
      api.submission(submissionId).then(
        ({ submission }) => {
          if (cancelled) return;
          setSubmission(submission);
          if (submission.status === "SUBMITTED" || submission.status === "EVALUATING") timer = setTimeout(load, POLL_MS);
        },
        (e: Error) => !cancelled && setError(e.message),
      );
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [submissionId, reloadKey]);

  async function retry() {
    setBusy(true);
    try {
      await api.retry(submissionId);
      setReloadKey((k) => k + 1); // restart polling
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function tryAgain() {
    if (!submission?.attempt) return;
    setBusy(true);
    try {
      const { attempt } = await api.startAttempt(submission.attempt.problemId);
      navigate(`/attempts/${attempt.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!submission) return <p className="muted">Loading submission…</p>;
  const { status, feedback, attempt } = submission;
  const pending = status === "SUBMITTED" || status === "EVALUATING";

  return (
    <>
      <p className="eyebrow">
        <a href={`#/attempts/${submission.attemptId}`}>
          {attempt?.problemTitle} · Attempt v{attempt?.version}
        </a>
      </p>
      <h1>Feedback</h1>

      <ol className="stepper" aria-label="Evaluation status">
        {STEPS.map((step, i) => {
          const reached = status === "FAILED" ? i <= 1 : STEPS.indexOf(status) >= i;
          const label = step === "COMPLETED" && status === "FAILED" ? "Failed" : step.charAt(0) + step.slice(1).toLowerCase();
          return (
            <li key={step} className={`${reached ? "reached" : ""} ${status === "FAILED" && i === 2 ? "failed" : ""}`}>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="muted small" aria-live="polite">
        {pending && "Your design is saved. Evaluation runs in the background; this page refreshes every 3 seconds."}
      </p>

      {status === "FAILED" && (
        <div className="banner error">
          <p>{submission.failureReason}</p>
          <button onClick={retry} disabled={busy}>
            {busy ? "Retrying…" : "Retry evaluation"}
          </button>
        </div>
      )}

      {feedback && <FeedbackView feedback={feedback} />}

      {status === "COMPLETED" && (
        <div className="next-step">
          <div>
            <strong>Ready for the real test?</strong>
            <p className="muted">Your next attempt adds a requirement change. Feedback checks how well your design absorbs it.</p>
          </div>
          <button onClick={tryAgain} disabled={busy}>
            Try again with a change request
          </button>
        </div>
      )}

      <details className="submitted">
        <summary>Your submitted design</summary>
        {Object.entries(submission.content.sections ?? {}).map(([k, v]) => (
          <div key={k}>
            <h4>{k}</h4>
            <pre>{v}</pre>
          </div>
        ))}
      </details>
    </>
  );
}

function FeedbackView({ feedback }: { feedback: Feedback }) {
  const isMock = feedback.model?.startsWith("mock") ?? false;
  const byDimension = new Map<Dimension, Finding[]>();
  for (const f of feedback.findings) byDimension.set(f.criterion, [...(byDimension.get(f.criterion) ?? []), f]);

  return (
    <section aria-label="Feedback">
      {feedback.partial && (
        <div className="banner warn">
          <strong>Partial feedback.</strong> The AI review did not finish, so only the deterministic rule checks are shown.
        </div>
      )}
      {feedback.stoppedEarly && (
        <div className="banner warn">
          A structural problem stopped the review early. Fix it and resubmit for a full review.
        </div>
      )}
      {isMock && (
        <p className="muted small">
          Scored by the <strong>mock evaluator</strong> (keyword heuristics, no API key). Set an LLM provider for real
          design judgement.
        </p>
      )}

      {feedback.topFix && (
        <div className="top-fix">
          <p className="eyebrow">Fix this next · {feedback.topFix.label}</p>
          <p className="top-fix-text">{feedback.topFix.suggestion}</p>
          {feedback.topFix.evidence && <blockquote>{feedback.topFix.evidence}</blockquote>}
        </div>
      )}

      <div className="scores">
        {feedback.scores.map((s) => (
          <a key={s.dimension} className="score-row" href={`#f-${s.dimension}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`f-${s.dimension}`)?.scrollIntoView({ behavior: "smooth" });
          }}>
            <span>{s.label}</span>
            <ScoreBar score={s.score} />
          </a>
        ))}
      </div>

      {feedback.scores.map((s) => {
        const findings = byDimension.get(s.dimension) ?? [];
        if (findings.length === 0) return null;
        return (
          <div key={s.dimension} id={`f-${s.dimension}`} className="dimension">
            <h3>
              {s.label} <ScoreBar score={s.score} />
            </h3>
            {findings.map((f, i) => (
              <article key={i} className={`finding ${f.worthChecking ? "hint" : ""}`}>
                <div className="finding-tags">
                  <span className={`tag ${f.source}`}>{f.source === "llm" && isMock ? "mock" : f.source}</span>
                  {f.worthChecking && <span className="tag check">worth checking</span>}
                  <span className="muted small">score {f.score}/4 · confidence {Math.round(f.confidence * 100)}%</span>
                </div>
                {f.evidence ? (
                  <blockquote>{f.evidence}</blockquote>
                ) : (
                  <p className="absent">Not found in your submission</p>
                )}
                <p>{f.concern}</p>
                <p className="suggestion">→ {f.suggestion}</p>
              </article>
            ))}
          </div>
        );
      })}

      <p className="muted small provenance">
        Evaluated by {feedback.evaluatedBy.join(" → ") || "—"}
        {feedback.model && ` · model ${feedback.model}`}
        {feedback.promptVersion && ` · prompt ${feedback.promptVersion}`}
        {feedback.droppedFindings > 0 &&
          ` · ${feedback.droppedFindings} AI finding(s) removed because their quote was not in your submission`}
      </p>
    </section>
  );
}
