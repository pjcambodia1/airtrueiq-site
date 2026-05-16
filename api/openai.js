// api/openai.js
// AirTrueIQ / AirAware Wellness Report API for Vercel
//
// Required Vercel environment variable:
// OPENAI_API_KEY=sk-...

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Missing OPENAI_API_KEY on server."
    });
  }

  try {
    const payload = req.body || {};

    const systemPrompt = `
You are AirAware's wellness report assistant.

You provide concise, non-medical atmospheric wellness guidance based on verified environmental data supplied by the app.

Rules:
- Do not diagnose, treat, or prescribe.
- Do not claim certainty.
- Use wellness language only.
- Explain how current air conditions may feel to the body.
- Mention PLD, density altitude, 24h shift, 30m shift, BP profile, pulse, and body sensitivity only when provided.
- Keep the tone practical, calm, and clear.
- Return JSON only.

Required JSON format:
{
  "headline": "short title",
  "summary": "brief practical summary",
  "highBpNote": "note for high BP tendency",
  "lowBpNote": "note for low BP tendency",
  "bodySignalNote": "note about pulse/body sensitivity",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "patternInsights": ["pattern note 1"],
  "confidence": "low | medium | high",
  "disclaimer": "Wellness guidance only. Not medical advice."
}
`;

    const userPrompt = `
Create an AirAware wellness report from this app payload:

${JSON.stringify(payload, null, 2)}
`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: "OpenAI request failed",
        details: data
      });
    }

    const outputText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch (e) {
      return res.status(500).json({
        error: "OpenAI returned invalid JSON",
        raw: outputText
      });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      message: error.message
    });
  }
}
