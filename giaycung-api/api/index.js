// api/index.js
// ✅ Dispatcher để giữ compatibility với vercel.json (functions pattern api/index.js)
// ✅ Không dùng express
// ✅ Forward request đến đúng file trong /api/*

export default async function handler(req, res) {
  try {
    const url = req.url || "";
    const path = url.split("?")[0] || "";

    // Ping
    if (path === "/api" || path === "/api/") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, message: "api index" }));
    }

    // ✅ Forward ALL /api/service-orders* (bao gồm OPTIONS preflight)
    if (path.startsWith("/api/service-orders")) {
      const mod = await import("./service-orders/[...slug].js");
      return mod.default(req, res);
    }

    // ✅ Forward orders
    if (path === "/api/orders") {
      const mod = await import("./orders/index.js");
      return mod.default(req, res);
    }

    const m = path.match(/^\/api\/orders\/([^/]+)$/);
    if (m) {
      req.query = req.query || {};
      req.query.id = decodeURIComponent(m[1]);
      const mod = await import("./orders/[id].js");
      return mod.default(req, res);
    }

    // 404 fallback
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, message: "Not found" }));
  } catch (err) {
    console.error("api/index dispatcher error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        message: "Server error",
        detail: String(err?.message || err),
      })
    );
  }
}
