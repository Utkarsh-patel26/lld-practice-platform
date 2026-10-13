import { useEffect, useRef, useState } from "react";
import { api, ApiError, idempotencyKey, type Attempt, type Problem, type Submission } from "../api";
import { navigate } from "../router";
import { StatusBadge } from "./SubmissionPage";

/** Mirrors TEXT_DESIGN_SECTIONS on the server (order matters for the idempotency hash). */
const SECTIONS = [
  {
    key: "requirements",
    label: "1. Requirements & assumptions",
    min: 40,
    hint: "Restate what the system must do, and the assumptions that resolve anything ambiguous.",
  },
  { key: "classes", label: "2. Classes & responsibilities", min: 40, hint: "One line per class: `- Name: what it owns and does`." },
  {
    key: "interfaces",
    label: "3. Key interfaces (code)",
    min: 40,
    hint: "The important classes/interfaces as code, any language. Signatures are enough.",
    code: true,
  },
  { key: "flow", label: "4. Main use-case flow", min: 40, hint: "Walk through the main use case, including what happens when it fails." },
  { key: "tradeoffs", label: "5. Trade-offs & alternatives", min: 30, hint: "What else did you consider, and why did you choose this?" },
] as const;

type Sections = Record<string, string>;
type SaveState = "idle" | "saving" | "saved" | "error";

export function AttemptPage({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<{ attempt: Attempt; problem: Problem; submissions: Submission[] } | null>(null);
  const [sections, setSections] = useState<Sections>({});
  const [save, setSave] = useState<{ state: SaveState; at?: string }>({ state: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    api.attempt(attemptId).then(
      (d) => {
        setData(d);
        const draft: Sections = {};
        for (const s of SECTIONS) draft[s.key] = typeof d.attempt.draft[s.key] === "string" ? (d.attempt.draft[s.key] as string) : "";
        setSections(draft);
        if (d.attempt.draftUpdatedAt) setSave({ state: "saved", at: d.attempt.draftUpdatedAt });
      },
      (e: Error) => setSubmitError(e.message),
    );
  }, [attemptId]);

  // Autosave: 800 ms after the last keystroke.
  useEffect(() => {
    if (!dirty.current) return;
    setSave({ state: "saving" });
    const timer = setTimeout(() => {
      api.saveDraft(attemptId, sections).then(
        (r) => setSave({ state: "saved", at: r.draftUpdatedAt }),
        () => setSave({ state: "error" }),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [sections, attemptId]);

  function update(key: string, value: string) {
    dirty.current = true;
    setSections((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const key = await idempotencyKey(attemptId, SECTIONS.map((s) => s.key), sections);
      const { submission } = await api.submit(attemptId, sections, key);
      navigate(`/submissions/${submission.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.field, d.message])));
      setSubmitError(e instanceof ApiError && e.code === "VALIDATION_FAILED" ? "Some sections need more work." : (e as Error).message);
      setSubmitting(false);
    }
  }

  if (!data) return submitError ? <div className="banner error">{submitError}</div> : <p className="muted">Loading attempt…</p>;
  const { attempt, problem, submissions } = data;
  const changeRequest = attempt.effectiveRequirements.find((r) => r.fromChangeRequest);

  return (
    <div className="editor">
      <aside className="problem-panel" aria-label="Problem">
        <p className="eyebrow">
          {problem.title} · Attempt v{attempt.version}
        </p>
        {changeRequest && (
          <div className="change-request" role="note">
            <strong>Change request: {problem.changeRequest.title}</strong>
            <p>{changeRequest.text}</p>
            <p className="muted small">Adapt your previous design. Feedback checks how well it absorbs this change.</p>
          </div>
        )}
        <p>{problem.description}</p>
        <h3>Requirements</h3>
        <ul className="checklist">
          {attempt.effectiveRequirements.map((r) => (
            <li key={r.id} className={r.fromChangeRequest ? "is-change" : undefined}>
              <span className="req-id">{r.id}</span> {r.text}
            </li>
          ))}
        </ul>
        <h3>Constraints</h3>
        <ul>
          {problem.constraints.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {submissions.length > 0 && (
          <>
            <h3>Earlier submissions in this attempt</h3>
            <ul className="plain">
              {submissions.map((s) => (
                <li key={s.id}>
                  <a href={`#/submissions/${s.id}`}>{new Date(s.createdAt).toLocaleString()}</a> <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <section className="design-form" aria-label="Your design">
        {SECTIONS.map((s) => {
          const value = sections[s.key] ?? "";
          const length = value.trim().length;
          return (
            <div className="field" key={s.key}>
              <label htmlFor={`f-${s.key}`}>{s.label}</label>
              <p className="hint" id={`h-${s.key}`}>
                {s.hint}
              </p>
              <textarea
                id={`f-${s.key}`}
                className={"code" in s ? "mono" : undefined}
                rows={"code" in s ? 12 : 6}
                value={value}
                spellCheck={!("code" in s)}
                aria-describedby={`h-${s.key} e-${s.key}`}
                aria-invalid={Boolean(errors[s.key])}
                onChange={(e) => update(s.key, e.target.value)}
              />
              <div className="field-foot">
                <span id={`e-${s.key}`} className="field-error">
                  {errors[s.key]}
                </span>
                <span className={length < s.min ? "count short" : "count"}>
                  {length}/{s.min}+
                </span>
              </div>
            </div>
          );
        })}
        <div className="submit-row">
          <span className="muted small" aria-live="polite">
            {save.state === "saving" && "Saving draft…"}
            {save.state === "saved" && save.at && `Draft saved ${new Date(save.at).toLocaleTimeString()}`}
            {save.state === "error" && "Draft not saved (will retry on next change)"}
          </span>
          {submitError && <span className="field-error">{submitError}</span>}
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for feedback"}
          </button>
        </div>
      </section>
    </div>
  );
}
