"use strict";
/**
 * AURAWATT IMS — Express + TypeScript Backend
 *
 * This file is now a thin entrypoint shim so existing commands like
 * `ts-node backend.ts` keep working after splitting the codebase into `src/`.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = void 0;
require("./src/index");
var app_1 = require("./src/app");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(app_1).default; } });
