import { useEffect, useState } from "react";
import { api, type ProblemSummary } from "../api";
import { navigate } from "../router";

export function ProblemsPage() {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    api.problems().then((r) => setProblems(r.problems), (e: Error) => setError(e.message));
  }, []);

  async function start(problemId: string) {
    setStarting(problemId);
    try {
      const { attempt } = await api.startAttempt(problemId);
      navigate(`/attempts/${attempt.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(null);
    }
  }

  return (
    <>
      <h1>Choose a problem</h1>
      <p className="lead">
        Write your design in five short sections. Feedback scores it against the requirements and a fixed rubric, not
        against one "correct" answer, and every point quotes your own words. Your second attempt adds a requirement change.
      </p>
      {error && <div className="banner error">{error}</div>}
      {!problems && !error && <p className="muted">Loading problems…</p>}
      <div className="cards">
        {problems?.map((p) => (
          <article key={p.id} className="card">
            <div className="card-head">
              <h2>{p.title}</h2>
              <span className={`pill ${p.difficulty}`}>{p.difficulty}</span>
            </div>
            <p>{p.summary}</p>
            <button onClick={() => start(p.id)} disabled={starting !== null}>
              {starting === p.id ? "Starting…" : "Start attempt"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
