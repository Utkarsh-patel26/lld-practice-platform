import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EvaluationContext } from "../domain/evaluation/evaluator.js";
import { RUBRIC, RUBRIC_DIMENSIONS } from "../domain/evaluation/rubric.js";

export interface BuiltPrompt {
  readonly system: string;
  readonly user: string;
}

const TAGS = ["problem", "requirements", "requirement", "rubric", "dimension", "rule_findings", "hint", "submission", "section"];
const TAG_PATTERN = new RegExp(`<(/?)(${TAGS.join("|")})\\b`, "gi");

/**
 * Learner text can't close or open our delimiter tags (e.g. a fake "</submission>"), so injected
 * text always stays inside <submission>. Other angle brackets (generics like List<Spot>) are left alone.
 */
export function neutralizeTags(text: string): string {
  return text.replace(TAG_PATTERN, "&lt;$1$2");
}

const attr = (value: string) => value.replace(/"/g, "'");

/** Loads a versioned prompt file and fills it from an EvaluationContext. */
export class RubricPrompt {
  private constructor(
    readonly version: string,
    private readonly systemTemplate: string,
    private readonly userTemplate: string,
  ) {}

  static load(path = fileURLToPath(new URL("./rubric-evaluator.v1.md", import.meta.url))): RubricPrompt {
    const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    const version = /^version:\s*(\S+)/m.exec(raw)?.[1];
    const [, afterSystem] = raw.split("=== SYSTEM ===\n");
    const [system, user] = (afterSystem ?? "").split("=== USER ===\n");
    if (!version || !system || !user) throw new Error(`Prompt file ${path} is missing version, SYSTEM or USER section`);
    return new RubricPrompt(version, system.trim(), user.trim());
  }

  build(ctx: EvaluationContext): BuiltPrompt {
    const { problem, attempt, requirements, input, priorFindings } = ctx;
    const values: Record<string, string> = {
      attempt_version: `${attempt.version}${attempt.includesChangeRequest ? " (includes the change request)" : ""}`,
      problem: [`Title: ${problem.title}`, problem.description, "Constraints:", ...problem.constraints.map((c) => `- ${c}`)].join("\n"),
      requirements: requirements
        .map(
          (r) =>
            `<requirement id="${r.id}"${r.fromChangeRequest ? ' from_change_request="true"' : ""}>${r.text}</requirement>`,
        )
        .join("\n"),
      rubric: RUBRIC_DIMENSIONS.map((dim) => {
        const spec = RUBRIC[dim];
        const anchors = ([1, 2, 3, 4] as const).map((s) => `${s}: ${spec.anchors[s]}`).join("\n");
        return `<dimension name="${dim}" question="${attr(spec.question)}">\n${anchors}\n</dimension>`;
      }).join("\n"),
      rule_findings:
        priorFindings.length === 0
          ? "none"
          : priorFindings
              .map((f, i) => {
                const quote = f.evidence ? ` Evidence: "${neutralizeTags(f.evidence)}"` : "";
                return `<hint id="H${i + 1}" dimension="${f.criterion}" confidence="${f.confidence}">${neutralizeTags(f.concern)}${quote}</hint>`;
              })
              .join("\n"),
      submission: input.sections
        .map((s) => `<section role="${s.role}" title="${attr(s.title)}">\n${neutralizeTags(s.text)}\n</section>`)
        .join("\n"),
    };
    // Single pass, so a "{{...}}" typed by the learner is never expanded.
    const user = this.userTemplate.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
    return { system: this.systemTemplate, user };
  }
}
