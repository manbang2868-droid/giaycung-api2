// api/ping.js

export default function handler(req, res) {
  // CORS tối thiểu để test
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Chỉ cho GET
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed",
    });
  }

  return res.status(200).json({
    ok: true,
    message: "pong",
    time: new Date().toISOString(),
  });
}
