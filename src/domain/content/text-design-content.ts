import { createHash } from "node:crypto";
import type { EvaluationInput, SectionRole } from "../evaluation/evaluator.js";
import type { FieldError, SubmissionContent, ValidationResult } from "./submission-content.js";

export const TEXT_DESIGN_FORMAT = "text-design";

interface SectionSpec {
  readonly key: SectionRole;
  readonly title: string;
  readonly minLength: number;
  readonly isCode: boolean;
}

/** The five sections a learner must fill. Order matters: it is the order shown to evaluators. */
export const TEXT_DESIGN_SECTIONS: readonly SectionSpec[] = [
  { key: "requirements", title: "Requirements & assumptions", minLength: 40, isCode: false },
  { key: "classes", title: "Classes & responsibilities", minLength: 40, isCode: false },
  { key: "interfaces", title: "Key interfaces (code)", minLength: 40, isCode: true },
  { key: "flow", title: "Main use-case flow", minLength: 40, isCode: false },
  { key: "tradeoffs", title: "Trade-offs & alternatives", minLength: 30, isCode: false },
];

export type TextDesignSections = Readonly<Record<SectionRole, string>>;

/** Today's only format: five structured text sections, one of them code. */
export class TextDesignContent implements SubmissionContent {
  readonly format = TEXT_DESIGN_FORMAT;
  private readonly sections: TextDesignSections;

  constructor(sections: Partial<Record<string, string>>) {
    const clean = {} as Record<SectionRole, string>;
    for (const spec of TEXT_DESIGN_SECTIONS) {
      const value = sections[spec.key];
      clean[spec.key] = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
    }
    this.sections = clean;
  }

  static fromJSON(data: unknown): TextDesignContent {
    const sections = (data as { sections?: unknown } | null)?.sections;
    if (typeof sections !== "object" || sections === null) return new TextDesignContent({});
    return new TextDesignContent(sections as Record<string, string>);
  }

  validate(): ValidationResult {
    const errors: FieldError[] = [];
    for (const spec of TEXT_DESIGN_SECTIONS) {
      const length = this.sections[spec.key].length;
      if (length === 0) errors.push({ field: spec.key, message: `${spec.title} is required.` });
      else if (length < spec.minLength)
        errors.push({
          field: spec.key,
          message: `${spec.title} is too short (${length} characters, need at least ${spec.minLength}).`,
        });
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  toEvaluationInput(): EvaluationInput {
    return {
      format: this.format,
      sections: TEXT_DESIGN_SECTIONS.map((s) => ({
        role: s.key,
        title: s.title,
        text: this.sections[s.key],
        isCode: s.isCode,
      })),
    };
  }

  contentHash(): string {
    const canonical = JSON.stringify(TEXT_DESIGN_SECTIONS.map((s) => this.sections[s.key]));
    return createHash("sha256").update(canonical).digest("hex");
  }

  toJSON(): { sections: TextDesignSections } {
    return { sections: this.sections };
  }
}
