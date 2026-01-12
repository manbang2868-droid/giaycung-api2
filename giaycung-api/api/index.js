// api/index.js
import express from "express";
import cors from "cors";

const app = express();

/** ✅ chỉ allow đúng domain FE */
const ALLOWED_ORIGIN = "https://giay-cung4.vercel.app";

const corsOptions = {
  origin: (origin, cb) => {
    // origin có thể undefined hoặc "null" (một số trường hợp)
    if (!origin || origin === "null") return cb(null, true);

    if (origin === ALLOWED_ORIGIN) return cb(null, true);

    // QUAN TRỌNG: trả error để middleware error bắt và trả JSON
    return cb(new Error(`Not allowed by CORS: ${origin}`), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
  credentials: false,
  maxAge: 86400,
};

app.use(express.json({ limit: "10mb" }));

// ✅ Enable CORS
app.use(cors(corsOptions));

// ✅ Fix preflight
app.options("*", cors(corsOptions));

/** ===== TEST ===== */
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, message: "pong" });
});

/** ===== ROUTES THẬT ===== */
app.get("/api/services", (req, res) => {
  // TODO: sau này đọc Google Sheet services ở đây
  res.json({ ok: true, data: [] });
});

app.get("/api/news", (req, res) => {
  res.json({ ok: true, data: [] });
});

/** ===== 404 ===== */
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

/** ✅ ERROR HANDLER (CHỐNG CRASH) */
app.use((err, req, res, next) => {
  console.error("API ERROR:", err);
  res
    .status(500)
    .json({ ok: false, message: err?.message || "Internal server error" });
});

/** ✅ Export chuẩn cho Vercel */
export default function handler(req, res) {
  return app(req, res);
}
