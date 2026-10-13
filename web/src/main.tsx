import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Meta } from "./api";
import { AttemptPage } from "./pages/AttemptPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ProblemsPage } from "./pages/ProblemsPage";
import { SubmissionPage } from "./pages/SubmissionPage";
import { useRoute } from "./router";
import "./styles.css";

function App() {
  const [section, id] = useRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.meta().then(setMeta, () => setMeta(null));
  }, []);

  let page;
  if (section === "attempts" && id) page = <AttemptPage key={id} attemptId={id} />;
  else if (section === "submissions" && id) page = <SubmissionPage key={id} submissionId={id} />;
  else if (section === "history") page = <HistoryPage />;
  else page = <ProblemsPage />;

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          LLD Practice
        </a>
        <nav>
          <a href="#/" aria-current={!section ? "page" : undefined}>
            Problems
          </a>
          <a href="#/history" aria-current={section === "history" ? "page" : undefined}>
            History
          </a>
        </nav>
        {meta && (
          <span className="evaluator-tag" title={meta.warning ?? `Evaluator: ${meta.provider} / ${meta.model}`}>
            {meta.provider === "mock" ? "Mock evaluator" : `${meta.provider} · ${meta.model}`}
          </span>
        )}
      </header>
      {meta?.warning && <div className="banner warn container">{meta.warning}</div>}
      <main className="container">{page}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
