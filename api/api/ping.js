export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    ok: true,
    route: "/api/ping",
    time: new Date().toISOString()
  });
}
