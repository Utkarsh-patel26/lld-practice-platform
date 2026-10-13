import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ContentValidationError } from "../domain/content/submission-content.js";
import { DomainError } from "../domain/errors.js";

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  UNKNOWN_FORMAT: 400,
  ILLEGAL_TRANSITION: 409,
};

/** Every error leaves the API as { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Request body or parameters are invalid.",
        details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof DomainError) {
    res.status(STATUS_BY_CODE[err.code] ?? 400).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err instanceof ContentValidationError ? { details: err.errors } : {}),
      },
    });
    return;
  }
  if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Body is not valid JSON." } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
};
