// api/index.js
// ✅ Dispatcher để giữ compatibility với vercel.json (functions pattern api/index.js)
// ✅ Không dùng express (tránh lỗi missing package)
// ✅ Forward request đến đúng file trong /api/*

import serviceOrdersHandler from "./service-orders.js";

export default async function handler(req, res) {
  try {
    // Đường dẫn gốc: /api/...
    const url = req.url || "";
    const path = url.split("?")[0] || "";

    // ✅ Forward service-orders (ALL: /api/service-orders, /api/service-orders/:id, /api/service-orders/:id/shoes/...)
    if (path.startsWith("/api/service-orders")) {
      return serviceOrdersHandler(req, res);
    }

    // Nếu request chính là /api hoặc /api/ -> trả ping
    if (path === "/api" || path === "/api/") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, message: "api index" }));
    }

    // ✅ Forward orders
    // /api/orders
    if (path === "/api/orders") {
      const mod = await import("./orders/index.js");
      return mod.default(req, res);
    }

    // /api/orders/:id
    const m = path.match(/^\/api\/orders\/([^/]+)$/);
    if (m) {
      req.query = req.query || {};
      req.query.id = decodeURIComponent(m[1]);
      const mod = await import("./orders/[id].js");
      return mod.default(req, res);
    }

    // ✅ Forward các route khác nếu bạn có:
    // /api/products ...
    // if (path === "/api/products") {
    //   const mod = await import("./products/index.js");
    //   return mod.default(req, res);
    // }

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
