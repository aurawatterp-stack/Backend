import jwt from "jsonwebtoken";

import { CONFIG } from "../config";
import type { JwtPayload } from "../types";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES_IN } as jwt.SignOptions);
}

