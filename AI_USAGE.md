# AI Usage

I used AI as a design sparring partner and as an implementer, and kept the decisions (and the checking) for myself. In the research and design session I used Claude to critique options. I then wrote a detailed build brief (scope, domain model, rubric, failure handling, tests) and had Claude Code implement it phase by phase while I reviewed the output. Every decision below is also in the running log, [`docs/ai-log.md`](docs/ai-log.md).

## Five decisions

**1. Grade against a reference solution, or against requirements + a rubric?**

- *AI suggested:* the obvious first design compared the learner's classes with a model solution (similar to AlgoMaster's per-stage reference grading).
- *I chose:* a per-problem requirement checklist plus a fixed 6-dimension rubric.
- *Why:* LLD has many valid answers. Reference matching punishes a correct design that differs from the reference, and teaches copying. The rubric judges qualities (cohesion, coupling, extensibility) that any valid design can show.

**2. One 100-point AI score, or 1–4 per dimension with anchors?**

- *AI suggested:* an overall score with a short explanation.
- *I rejected it:* a single number gives no direction, and an LLM's 73 vs 78 is noise.
- *Built:* a 1–4 score per dimension, each score with a written anchor sentence (`rubric.ts`). The scores are computed in code from the findings, and so is the "fix this next".

**3. Trust the LLM's findings, or verify them?**

- *AI suggested:* asking the model to "cite evidence" in the prompt.
- *I accepted, plus a code check:* `EvidenceVerifier` drops any finding whose quote is not actually in the submission (case and whitespace insensitive). The top fix is also picked by code from verified findings, rather than written by the LLM.
- *Trade-off I accepted:* a correct point the model paraphrased instead of quoting is lost.

**4. State pattern or transition table for submission status?**

- *AI suggested:* the State pattern, a common textbook answer for status workflows.
- *I chose:* a transition table.
- *Why:* SUBMITTED/EVALUATING/COMPLETED/FAILED have no behaviour of their own, only rules about which may follow which. A State class per status would be a pattern added to show off.
- *Verification:* the AI-written tests caught a real bug in the AI-written code. Because the table allows SUBMITTED → EVALUATING, "retry" was accepted on a submission that had never failed. Retry is now an explicit FAILED-only rule.

**5. Text, diagram and code, or structured text only?**

- *AI suggested:* supporting all three for "more evidence".
- *I chose:* structured text in five sections, one of them code.
- *Why:* it is the smallest format that shows both reasoning and abstraction, and a diagram editor would have eaten the time budget. To show diagrams can be added later, change test A runs a fake class-diagram format through the unchanged flow.

## How I worked with AI

- **Separate roles.** I used AI for design critique (asking it to argue against a design) and, separately, for implementation against a written brief. The AI never decided scope.
- **Structured output, not open questions.** The evaluator prompt is versioned (`rubric-evaluator.v1.md`), fixes the rubric with anchors, tags every input, and demands JSON. That JSON is validated with zod and gets one repair retry.
- **Adversarial checks.** The prompt treats the submission as untrusted data, and code escapes delimiter tags, which a test proves. I asked the AI to write failure-case tests: timeouts, invalid JSON, lease expiry and injection. These tests, not just happy paths, are how I accepted the code.
- **Verify against reality, not memory.** The brief asked for temperature 0. Before coding, the current Claude API reference showed that current Claude models reject non-default sampling parameters, so the Anthropic client omits it. Consistency comes from the anchors, the schema and code-side scoring. This deviation is noted in the design note.
- **Every AI output gets a check:** tests (37), quote verification, schema validation, and a manual run of the full flow, including a forced failure with a bad API key.
