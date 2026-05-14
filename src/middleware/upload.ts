import multer from "multer";

import { CONFIG } from "../config";

// CSV upload middleware (used by serial import).
export const upload = multer({
  dest: CONFIG.UPLOAD_DIR,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

