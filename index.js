// api/index.js
import express from "express";
import cors from "cors";

const app = express();

/** ✅ Chỉ allow đúng domain này */
const ALLOWED_ORIGIN = "https://giay-cung4.vercel.app";

const corsOptions = {
  origin: (origin, cb) => {
    // origin có thể undefined (curl/postman/server-to-server)
    if (!origin) return cb(null, true);

    // chỉ cho phép đúng domain
    if (origin === ALLOWED_ORIGIN) return cb(null, true);

    return cb(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
  credentials: false, // nếu bạn dùng cookie thì đổi true + origin không được là "*"
  maxAge: 86400,
};

// ✅ Parse JSON
app.use(express.json({ limit: "10mb" }));

// ✅ Enable CORS cho mọi route
app.use(cors(corsOptions));

// ✅ Fix preflight OPTIONS
app.options("*", cors(corsOptions));

/** ====== TEST ROUTE ====== */
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, message: "pong" });
});

/** ====== Ví dụ /api/news ====== */
app.get("/api/news", (req, res) => {
  res.json({ ok: true, data: [] });
});

/** ====== Nếu route không tồn tại ====== */
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

/** ✅ Quan trọng: export default cho Vercel */
export default app;
