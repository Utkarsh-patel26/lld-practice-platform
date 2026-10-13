import { submissionText, type EvaluationInput, type Finding } from "../domain/evaluation/evaluator.js";
import type { EvidenceCheck } from "../domain/evaluation/pipeline.js";

/** Quotes shorter than this (after normalising) are too generic to count as evidence, e.g. "Spot". */
export const MIN_EVIDENCE_CHARS = 8;

/** Lower-cases, unifies curly quotes and collapses whitespace, so line wrapping or case can't fail a real quote. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keeps a finding only if its evidence really appears in the submission. This is what makes
 * "every finding quotes your design" a guarantee rather than a hope. Cost: a correct point the
 * model paraphrased instead of quoting is lost.
 */
export class EvidenceVerifier implements EvidenceCheck {
  verify(findings: readonly Finding[], input: EvaluationInput): { kept: Finding[]; dropped: Finding[] } {
    const haystack = normalizeForMatch(submissionText(input));
    const kept: Finding[] = [];
    const dropped: Finding[] = [];
    for (const finding of findings) {
      const quote = finding.evidence === null ? "" : normalizeForMatch(finding.evidence);
      if (quote.length >= MIN_EVIDENCE_CHARS && haystack.includes(quote)) kept.push(finding);
      else dropped.push(finding);
    }
    return { kept, dropped };
  }
}
