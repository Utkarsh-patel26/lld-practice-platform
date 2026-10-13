import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Problem, ProblemRepository } from "../../domain/problem.js";

const keywords = z.array(z.string().min(2)).min(1);
const problemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  difficulty: z.enum(["easy", "medium", "hard"]),
  summary: z.string().min(10),
  description: z.string().min(20),
  requirements: z.array(z.object({ id: z.string(), text: z.string().min(5), keywords })).min(5).max(7),
  constraints: z.array(z.string()),
  changeRequest: z.object({ id: z.string(), title: z.string(), text: z.string().min(10), keywords }),
});

export const DEFAULT_PROBLEMS_DIR = fileURLToPath(new URL("../../data/problems", import.meta.url));

/** Problems are content, not user data: versioned JSON files, validated once at startup. */
export class JsonProblemRepository implements ProblemRepository {
  private readonly problems: Problem[];

  constructor(dir = DEFAULT_PROBLEMS_DIR) {
    this.problems = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const parsed = problemSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
        if (!parsed.success) throw new Error(`Invalid problem file ${f}: ${parsed.error.message}`);
        return parsed.data;
      });
  }

  list(): Problem[] {
    return [...this.problems];
  }

  get(id: string): Problem | undefined {
    return this.problems.find((p) => p.id === id);
  }
}
