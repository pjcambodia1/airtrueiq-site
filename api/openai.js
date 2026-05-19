// api/openai.js
// AirTrueIQ / AirAware Wellness Report API
// v82r9: CORS-safe, APK-safe, PPD-aware

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeReportFallback(message, payload = {}) {
  const transition = payload.transitionPattern || {};
  return {
    headline: "AirTrueIQ report service notice",
    summary: message || "The report service could not complete the AI request.",
    transitionNote: transition.active
      ? `${transition.type || "Transition pattern"} detected: ${transition.summary || "A PLD / air-density divergence pattern was included in the app payload."}`
      : "No active PPD / Inverse PPD transition pattern was detected in the payload.",
    bpNote: "Use BP entries only as personal wellness context. Use a real cuff/device for BP decisions.",
    bodyNote: "Body response may differ by profile. Sensitive, higher-BP, lower-BP, or narrow-pulse-pressure patterns may respond differently.",
    suggestions: [
      "Retest the wellness report after confirming internet connection.",
      "Log symptoms, BP, pulse, and the transition pattern if you notice a body response.",
      "Use this as wellness guidance only, not medical advice."
    ],
    confidence: "low",
    disclaimer: "Wellness guidance only. Not medical advice."
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const payload = req.body || {};

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(200).json(
        safeReportFallback("OPENAI_API_KEY is missing on the server.", payload)
      );
    }

    const transition = payload.transitionPattern || {};
    const transitionActive = !!transition.active;

    const systemPrompt = `
You are AirTrueIQ's wellness report engine.

Return JSON only. Do not use markdown.

You create concise, specific, non-medical wellness guidance from AirAware/AirTrueIQ atmospheric data.

Rules:
- Do not diagnose.
- Do not claim medical causation.
- Do not say the air caused symptoms.
- Use careful phrases: may feel, may notice, worth logging, transition window, wellness guidance only.
- If transitionPattern.active is true, you MUST address it specifically.
- If transitionPattern.type is Post-Peak Divergence, explain the descending-gap transition: air density rising while PLD drops from a recent peak.
- If transitionPattern.type is Inverse Post-Peak Divergence, explain the ascending-gap transition: air density easing while PLD rebounds from a recent low.
- Mention dropFromPeak or reboundFromLow if provided.
- Mention density direction/slope and PLD slope if provided.
- Mention that higher-BP, lower-BP, narrow-pulse-pressure, or sensitive profiles may respond differently if provided or relevant.
- Avoid generic weather advice.
- Keep suggestions practical and mild.

Return exactly this JSON shape:
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
Generate an AirTrueIQ wellness report from this payload.

transitionPatternActive: ${transitionActive}
transitionPattern: ${JSON.stringify(transition, null, 2)}

Full app payload:
${JSON.stringify(payload, null, 2)}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        text: {
          format: { type: "json_object" }
        }
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      return res.status(200).json(
        safeReportFallback(
          `OpenAI request failed: HTTP ${response.status}. ${raw.slice(0, 300)}`,
          payload
        )
      );
    }

    let wrapper;
    try {
      wrapper = JSON.parse(raw);
    } catch (e) {
      return res.status(200).json(
        safeReportFallback("OpenAI wrapper was not valid JSON.", payload)
      );
    }

    const outputText =
      wrapper.output_text ||
      wrapper.output?.[0]?.content?.[0]?.text ||
      "";

    if (!outputText) {
      return res.status(200).json(
        safeReportFallback("OpenAI returned no usable report text.", payload)
      );
    }

    let report;
    try {
      report = JSON.parse(outputText);
    } catch (e) {
      return res.status(200).json(
        safeReportFallback("OpenAI report text was not valid JSON.", payload)
      );
    }

    setCors(res);
    return res.status(200).json(report);

  } catch (err) {
    setCors(res);
    return res.status(200).json(
      safeReportFallback(`Server error: ${err.message || String(err)}`, payload)
    );
  }
}
