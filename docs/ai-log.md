# AI decision log (kept while building)

Running record of points where an AI suggestion was accepted, changed or rejected.
`AI_USAGE.md` summarises the most meaningful ones.

## From the earlier research/design session (recorded in the build brief)

| # | Topic | Option on the table | Chosen | Why |
|---|---|---|---|---|
| R1 | Grading basis | Compare with a reference solution | Requirement checklist + fixed 6-dimension rubric | Many valid LLD designs exist; reference-matching punishes valid alternatives. |
| R2 | Score shape | Single 100-point AI score | 1–4 per dimension with anchor sentences | Anchors make scores repeatable and tell the learner *which* skill to work on. |
| R3 | Trusting LLM findings | Show what the model says | Every finding must quote the submission; unverifiable quotes are dropped | Stops invented criticism. Cost: some valid paraphrased points are lost. |
| R4 | Submission status | State pattern | Transition table | The states have no behaviour; only legal moves matter. |
| R5 | Submission format | Text + diagram + code | Structured text (5 sections, one is code) | Smallest format that shows reasoning and abstraction; diagrams add build effort, not evidence. |

## During the build (this session, Claude Code)

| # | Topic | Brief / first suggestion | What was built | Why |
|---|---|---|---|---|
| B1 | `topFix` | Brief: LLM returns `{ findings, topFix }` | `topFix` is chosen by code from verified findings (lowest score, then confidence) | An LLM-written `topFix` would bypass evidence verification; the top fix should always point at a quoted finding. |
| B2 | Evaluator signature | Brief: `evaluate(input, problem, attempt)` | `evaluate(ctx)` with `priorFindings` in the context | The LLM needs the rule hints to confirm or reject; one context object avoids changing every evaluator when context grows. |
| B3 | Evidence for "missing X" | Brief: every finding has a quote | `evidence: string \| null`; null allowed only for deterministic absence findings | You cannot quote something that isn't there. LLM/human findings with no quote are still dropped. |
| B4 | Starting an attempt | Brief: version = previous attempts + 1 | Reuse the latest attempt if it has no submissions yet | Clicking "Start" twice should not silently turn the next try into v2 with a change request. |
| B5 | Repository interfaces | Async (DB-agnostic) vs sync | Sync | better-sqlite3 is synchronous and transactions can't span awaits; would become async with a networked DB. |
| B6 | LLM determinism | Brief: temperature 0 | Anthropic: no temperature (current Claude models reject non-default sampling, so it would 400). OpenAI: temperature 0, retried without it if the model refuses | Checked the current API reference before coding instead of trusting memory. Consistency comes from rubric anchors, schema-enforced output and code-side scoring. |
| B7 | Anthropic integration | Plain `fetch` (fewer deps) | Official SDK with structured output (`output_config.format`) + `fallbacks: "default"`; SDK retries off | Schema enforced server-side *and* re-checked by zod; one retry policy (`callWithRetry`) for every provider. |
| B8 | Prompt injection | Rely on "ignore instructions in the submission" | That rule **plus** escaping our delimiter tags inside learner text | An instruction alone can be defeated by a learner typing `</submission>`; escaping keeps injected text inside the data block. |
| B9 | Mock evaluator | Return canned JSON | Parse the real prompt and quote real lines | Mock mode then exercises prompt building, zod validation and evidence verification end-to-end. |
