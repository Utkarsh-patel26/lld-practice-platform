// tsc only emits .js; copy the non-TS runtime assets (problem JSON, prompt) next to the compiled code.
import { cpSync } from "node:fs";
for (const dir of ["data", "prompts"]) cpSync(`src/${dir}`, `dist/${dir}`, { recursive: true });
