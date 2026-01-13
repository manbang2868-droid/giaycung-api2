// api/index.js
// ✅ Dispatcher để giữ compatibility với vercel.json (functions pattern api/index.js)
// ✅ Không dùng express (tránh lỗi missing package)
// ✅ Forward request đến đúng file trong /api/*
// ✅ Dùng WHATWG URL API (tránh warning url.parse)

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || "/api", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname || "";

    // /api hoặc /api/ -> ping
    if (path === "/api" || path === "/api/") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, message: "api index" }));
    }

    // ====== SIMPLE DIRECT ROUTES ======
    // /api/login
    if (path === "/api/login") {
      const mod = await import("./login.js");
      return mod.default(req, res);
    }

    // /api/services
    if (path === "/api/services") {
      const mod = await import("./services.js");
      return mod.default(req, res);
    }

    // /api/products
    if (path === "/api/products") {
      const mod = await import("./products.js");
      return mod.default(req, res);
    }

    // /api/news
    if (path === "/api/news") {
      const mod = await import("./news.js");
      return mod.default(req, res);
    }

    // /api/messages
    if (path === "/api/messages") {
      const mod = await import("./messages.js");
      return mod.default(req, res);
    }

    // /api/contact
    if (path === "/api/contact") {
      const mod = await import("./contact.js");
      return mod.default(req, res);
    }

    // ====== ORDERS ======
    // /api/orders
    if (path === "/api/orders") {
      const mod = await import("./orders/index.js");
      return mod.default(req, res);
    }

    // /api/orders/:id
    const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch) {
      req.query = req.query || {};
      req.query.id = decodeURIComponent(orderMatch[1]);
      const mod = await import("./orders/[id].js");
      return mod.default(req, res);
    }

    // ====== SERVICE ORDERS (CATCH-ALL) ======
    // /api/service-orders + /api/service-orders/*
    if (path === "/api/service-orders" || path.startsWith("/api/service-orders/")) {
      // Ưu tiên file mới: api/service-orders/[...slug].js
      // (file này tự parse req.url để route)
      try {
        const mod = await import("./service-orders/[...slug].js");
        return mod.default(req, res);
      } catch (e) {
        // fallback nếu bạn còn dùng api/service-orders.js cũ
        const mod = await import("./service-orders.js");
        return mod.default(req, res);
      }
    }

    // ====== 404 fallback ======
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
