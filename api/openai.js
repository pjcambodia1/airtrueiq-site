// api/openai.js
// AirTrueIQ / AirAware Wellness Report API
// v82r8-compatible: includes PPD / Inverse PPD transitionPattern handling

export default async function handler(req, res) {
  // CORS for APK WebView / browser calls
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing on the server."
      });
    }

    const payload = req.body || {};
    const transition = payload.transitionPattern || {};
    const transitionActive = !!transition.active;

    const transitionInstruction = transitionActive
      ? `
IMPORTANT TRANSITION PATTERN:
The app detected ${transition.type || "a PLD / air-density divergence pattern"}.
Level: ${transition.level || "unknown"}.
Summary: ${transition.summary || "No summary provided."}
Direction feel: ${transition.directionFeel || "not specified"}.
Peak time: ${transition.peakTime || "n/a"}.
Peak PLD: ${transition.peakPLD ?? "n/a"}.
Low time: ${transition.lowTime || "n/a"}.
Low PLD: ${transition.lowPLD ?? "n/a"}.
Current time: ${transition.currentTime || "n/a"}.
Current PLD: ${transition.currentPLD ?? "n/a"}.
Current density: ${transition.currentDensity ?? "n/a"}.
Drop from peak: ${transition.dropFromPeak ?? "n/a"} m DA.
Rebound from low: ${transition.reboundFromLow ?? "n/a"} m DA.
Density slope: ${transition.densitySlope ?? "n/a"}.
PLD slope: ${transition.pldSlope ?? "n/a"}.
Profile note: ${transition.profileNote || "Sensitive users may respond differently by profile."}

You MUST specifically explain this transition pattern in the report.
Do not give a generic weather report.
Use careful wellness wording. Do not claim medical causation.
`
      : `
No active PPD / Inverse PPD transition pattern was detected.
If discussing trends, say no specific divergence pattern was flagged.
`;

    const systemPrompt = `
You are AirTrueIQ's wellness report engine.

You generate concise, specific, non-medical wellness guidance based on atmospheric data supplied by the AirAware/AirTrueIQ app.

Rules:
- Return JSON only.
- Do not use markdown.
- Do not diagnose, prescribe, or claim medical causation.
- Do not say the app "caused" symptoms.
- Use wording like "may feel", "may notice", "worth logging", "transition window", "wellness guidance only".
- If transitionPattern is active, you MUST address it directly using its type, level, drop/rebound amount, density direction, and profile note.
- If BP or pulse data is present, discuss it carefully as user-entered context, not as a diagnosis.
- If the user has lower-BP, higher-BP, narrow pulse pressure, or sensitivity context, mention that profiles may respond differently.
- Keep it practical and specific. Avoid lazy generic advice.
- Include a disclaimer.

Return this JSON shape exactly:
{
  "headline": "string",
  "summary": "string",
  "transitionNote": "string",
  "bpNote": "string",
  "bodyNote": "string",
  "suggestions": ["string", "string", "string"],
  "confidence": "low|medium|high",
  "disclaimer": "string"
}
`;

    const userPrompt = `
Generate an AirTrueIQ wellness report from this app payload.

${transitionInstruction}

Full payload:
${JSON.stringify(payload, null, 2)}
`;

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
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

    const raw = await openaiResponse.text();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error: "OpenAI request failed.",
        status: openaiResponse.status,
        details: raw
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({
        error: "OpenAI returned non-JSON wrapper.",
        details: raw.slice(0, 1000)
      });
    }

    let outputText = "";

    try {
      outputText =
        parsed.output?.[0]?.content?.[0]?.text ||
        parsed.output_text ||
        "";
    } catch (e) {
      outputText = "";
    }

    if (!outputText) {
      return res.status(500).json({
        error: "OpenAI response had no output text.",
        details: parsed
      });
    }

    let report;
    try {
      report = JSON.parse(outputText);
    } catch (e) {
      return res.status(500).json({
        error: "OpenAI output was not valid JSON.",
        outputText
      });
    }

    return res.status(200).json(report);

  } catch (err) {
    return res.status(500).json({
      error: "Server error in AirTrueIQ OpenAI handler.",
      message: err.message || String(err)
    });
  }
}
