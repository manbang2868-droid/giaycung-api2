// api/index.js
// Dispatcher compatible Vercel functions

import { allowCors, json } from "./_lib/gsheets.js";

export default async function handler(req, res) {
  try {
    // ✅ 1) Handle CORS / Preflight first
    if (allowCors(req, res)) return;

    const url = new URL(req.url || "/api", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname || "";

    // /api hoặc /api/ -> ping
    if (path === "/api" || path === "/api/") {
      return json(res, 200, { ok: true, message: "api index" });
    }

    // ====== SIMPLE DIRECT ROUTES ======
    if (path === "/api/login") {
      const mod = await import("./login.js");
      return mod.default(req, res);
    }

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

    if (path === "/api/contact") {
      const mod = await import("./contact.js");
      return mod.default(req, res);
    }

    // ====== ORDERS ======
    if (path === "/api/orders") {
      const mod = await import("./orders/index.js");
      return mod.default(req, res);
    }

    const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch) {
      req.query = req.query || {};
      req.query.id = decodeURIComponent(orderMatch[1]);
      const mod = await import("./orders/[id].js");
      return mod.default(req, res);
    }

    // ====== SERVICE ORDERS (CATCH-ALL) ======
    if (path === "/api/service-orders" || path.startsWith("/api/service-orders/")) {
      try {
        const mod = await import("./service-orders/[...slug].js");
        return mod.default(req, res);
      } catch (e) {
        const mod = await import("./service-orders.js");
        return mod.default(req, res);
      }
    }

    // ✅ 2) 404 MUST return via json() to include CORS headers
    return json(res, 404, { ok: false, message: "Not found" });
  } catch (err) {
    console.error("api/index dispatcher error:", err);

    // ✅ 3) 500 MUST return via json() to include CORS headers
    return json(res, 500, {
      ok: false,
      message: "Server error",
      detail: String(err?.message || err),
    });
  }
}
