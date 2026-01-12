// api/index.js
// ✅ Dispatcher để giữ compatibility với vercel.json (functions pattern api/index.js)
// ✅ Không dùng express
// ✅ Forward request đến đúng file trong /api/*
// ✅ Dùng WHATWG URL API (tránh DEP0169)

export default async function handler(req, res) {
  try {
    const u = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const path = u.pathname || "";

    // /api or /api/
    if (path === "/api" || path === "/api/") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, message: "api index" }));
    }

    // ========= service-orders (catch-all) =========
    // Bạn ưu tiên dùng file: api/service-orders/[...slug].js
    if (path === "/api/service-orders" || path.startsWith("/api/service-orders/")) {
      const mod = await import("./service-orders/[...slug].js");
      return mod.default(req, res);
    }

    // ========= orders =========
    if (path === "/api/orders") {
      const mod = await import("./orders/index.js");
      return mod.default(req, res);
    }
    const mOrder = path.match(/^\/api\/orders\/([^/]+)$/);
    if (mOrder) {
      req.query = req.query || {};
      req.query.id = decodeURIComponent(mOrder[1]);
      const mod = await import("./orders/[id].js");
      return mod.default(req, res);
    }

    // ========= other flat endpoints =========
    // Các file dạng: api/<name>.js
    if (path === "/api/services") {
      const mod = await import("./services.js");
      return mod.default(req, res);
    }

    if (path === "/api/products") {
      const mod = await import("./products.js");
      return mod.default(req, res);
    }

    if (path === "/api/news") {
      const mod = await import("./news.js");
      return mod.default(req, res);
    }

    if (path === "/api/messages") {
      const mod = await import("./messages.js");
      return mod.default(req, res);
    }

    if (path === "/api/login") {
      const mod = await import("./login.js");
      return mod.default(req, res);
    }

    if (path === "/api/contact") {
      const mod = await import("./contact.js");
      return mod.default(req, res);
    }

    // 404
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
