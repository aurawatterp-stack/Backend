// Vercel Node Function entrypoint.
// Uses the compiled output (`dist/`) so runtime doesn't depend on TS/ESM resolution.

const app = require("../dist/src/app.js").default;

module.exports = (req, res) => app(req, res);

