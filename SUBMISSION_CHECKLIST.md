# Submission checklist

| Form field | What to use |
|---|---|
| Email / Full name / Contact number / LinkedIn | Fill in yourself |
| Research Note (PDF) | `docs/research-note.pdf` |
| Design Note (PDF) | `docs/design-note.pdf` |
| Working Prototype / GitHub Repo URL | https://github.com/Utkarsh-patel26/lld-practice-platform |
| README + AI_USAGE.md (File) | `SUBMISSION_README_AND_AI_USAGE.pdf` |
| How did you apply | Your choice |
| Clarity rating | Your choice |
| Additional Comments | Paste the text below |

## Additional Comments (draft)

The prototype runs end-to-end with no setup using a built-in mock evaluator, or with a real LLM by setting one environment variable (`LLM_PROVIDER=anthropic` or `openai` plus a key). Two ideas shape it: every feedback finding must quote the learner's own design, and code drops any finding whose quote is not actually in the submission; and the second attempt adds a requirement change, so the learner is tested on extensibility rather than on one-off solving. I used AI deliberately, with a versioned prompt, structured output, schema validation and evidence checks, and the decisions I accepted or rejected are listed in AI_USAGE.md.
