import { Router } from "express";
import type { Container } from "../../container.js";
import { problemDto, problemSummaryDto } from "../serializers.js";

export function problemRoutes(c: Container): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    res.json({ problems: c.practice.listProblems().map(problemSummaryDto) });
  });
  r.get("/:id", (req, res) => {
    res.json({ problem: problemDto(c.practice.getProblem(req.params.id)) });
  });
  return r;
}
