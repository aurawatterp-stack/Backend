import express, { type Request, type Response, type Router } from "express";

import { getIndiaGeography, getIndiaDistrictsForState, resolveIndiaStateName } from "../data/indiaGeography";
import { fail, ok } from "../utils/http";

const router: Router = express.Router();

router.get("/", (_req: Request, res: Response) => {
  return ok(res, getIndiaGeography());
});

router.get("/states", (_req: Request, res: Response) => {
  const { states } = getIndiaGeography();
  return ok(res, { states });
});

router.get("/districts", (req: Request, res: Response) => {
  const state = resolveIndiaStateName(req.query.state);
  if (!state) {
    return fail(res, "state is required", 400);
  }
  return ok(res, { state, districts: getIndiaDistrictsForState(state) });
});

export default router;

