/**
 * AURAWATT IMS — Express + TypeScript Backend
 *
 * This file is now a thin entrypoint shim so existing commands like
 * `ts-node backend.ts` keep working after splitting the codebase into `src/`.
 */

import "./src/index";

export { default } from "./src/app";
