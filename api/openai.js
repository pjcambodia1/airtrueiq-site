export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on Vercel." });
    }

    const payload = req.body || {};

    const prompt = `
You are AirTrueIQ wellness guidance.

Use wellness-only language. Do not diagnose, treat, or give medical advice.

Explain the user's atmospheric condition using:
- AirAware score
- density altitude burden
- 24h shift
- 30m shift
- DA/PLD compound divergence
- transitionPattern
- flipFlop data
- PPD / Inverse PPD if present
- BP profile
- pulse
- body sensitivity

Important:
PPD is NOT raw air density minus PLD.
PPD is a DA/PLD compound state over time:
densityNorm trend vs PLDNorm trend.
compoundGap = densityNorm - pldNorm.

Return concise JSON only:
{
  "headline": "",
  "summary": "",
  "bpNote": "",
  "bodyNote": "",
  "transitionNote": "",
  "suggestions": [],
  "confidence": "",
  "disclaimer": "Wellness guidance only, not medical advice."
}

Payload:
${JSON.stringify(payload, null, 2)}
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: "OpenAI request failed",
        detail: data
      });
    }

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    return res.status(200).json({
      ok: true,
      report: text,
      raw: data
    });

  } catch (err) {
    return res.status(500).json({
      error: "AirTrueIQ API crashed",
      detail: err.message
    });
  }
}
