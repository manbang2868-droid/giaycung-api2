// api/services.js

export default function handler(req, res) {
  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ===== Preflight =====
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ===== Chỉ cho GET =====
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed",
    });
  }

  // ===== DATA MOCK (frontend cần gì trả cái đó) =====
  const services = [
    {
      id: "svc_1",
      name: "Vệ sinh giày cơ bản",
      price: 50000,
      description: "Làm sạch bụi bẩn, đế và thân giày",
      status: "published",
    },
    {
      id: "svc_2",
      name: "Vệ sinh giày cao cấp",
      price: 120000,
      description: "Vệ sinh chi tiết + khử mùi",
      status: "published",
    },
  ];

  return res.status(200).json({
    ok: true,
    data: services,
  });
}
