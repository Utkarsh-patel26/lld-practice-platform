import { useEffect, useState } from "react";
import { api, type HistoryResponse } from "../api";
import { StatusBadge } from "./SubmissionPage";

export function HistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.history().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Loading history…</p>;
  const { attempts, progress } = data;
  const labels = attempts[0]?.scores ?? [];

  return (
    <>
      <h1>Your attempts</h1>
      {progress.weakest ? (
        <div className="weakest" role="note">
          <p className="eyebrow">Your weakest area</p>
          <p className="weakest-name">{progress.weakest.label}</p>
          <p className="muted">
            Average {progress.weakest.average}/4 · scored 2 or lower in {progress.weakest.weakIn} of{" "}
            {progress.weakest.scoredIn} completed attempt{progress.weakest.scoredIn === 1 ? "" : "s"}
          </p>
        </div>
      ) : (
        <p className="muted">Complete an attempt to see which rubric dimension needs the most work.</p>
      )}

      {attempts.length === 0 ? (
        <p>
          No attempts yet. <a href="#/">Pick a problem</a> to start.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Problem</th>
                <th scope="col">Version</th>
                <th scope="col">Date</th>
                <th scope="col">Status</th>
                {labels.map((s) => (
                  <th key={s.dimension} scope="col" className="dim-col" title={s.label}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attemptId}>
                  <td>{a.problemTitle}</td>
                  <td>v{a.version}</td>
                  <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td>
                    {a.latestSubmission ? (
                      <a href={`#/submissions/${a.latestSubmission.id}`}>
                        <StatusBadge status={a.latestSubmission.status} />
                      </a>
                    ) : (
                      <a href={`#/attempts/${a.attemptId}`}>Draft</a>
                    )}
                  </td>
                  {a.scores.map((s) => (
                    <td key={s.dimension} className={`score-cell s${s.score ?? 0}`}>
                      {s.score ?? "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
