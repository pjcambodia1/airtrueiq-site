// api/openai.js
// AirTrueIQ / AirAware Wellness Report API
// v82r12: CORS-safe, APK-safe, DA/PLD compound PPD + Inverse PPD + Flip-Flop aware

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeReportFallback(message, payload = {}) {
  const transition = payload.transitionPattern || {};
  const flip = transition.flipFlop || {};

  return {
    headline: "AirTrueIQ report service notice",
    summary: message || "The report service could not complete the AI request.",
    transitionNote: flip.active
      ? `Flip-Flop Transition detected: ${flip.summary || "PPD and Inverse PPD both occurred inside the rolling transition window."}`
      : transition.active
        ? `${transition.type || "Transition pattern"} detected: ${transition.summary || "A DA/PLD compound divergence pattern was included in the app payload."}`
        : "No active PPD / Inverse PPD / Flip-Flop transition pattern was detected in the payload.",
    bpNote: "Use BP entries only as personal wellness context. Use a real cuff/device for BP decisions.",
    bodyNote: "Body response may differ by profile. Sensitive, higher-BP, lower-BP, narrow-pulse-pressure, fatigue-sensitive, sinus/dental-pressure, or general sensitivity patterns may respond differently.",
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
    const flip = transition.flipFlop || {};
    const transitionActive = !!transition.active;
    const flipActive = !!flip.active;

    const systemPrompt = `
You are AirTrueIQ's wellness report engine.

Return JSON only. Do not use markdown.

You create concise, specific, non-medical wellness guidance from AirAware/AirTrueIQ atmospheric data.

Core rules:
- Do not diagnose.
- Do not claim medical causation.
- Do not say the air caused symptoms.
- Do not tell the user to change medicine.
- Use careful phrases: may feel, may notice, worth logging, transition window, wellness guidance only.
- Avoid generic weather advice.
- Keep suggestions practical and mild.
- Always preserve the wellness boundary: this is not medical advice.

DA/PLD compound divergence rules:
- The app may send a transitionPattern object.
- This object is based on a DA/PLD compound divergence state, not raw air-density-minus-PLD subtraction.
- If transitionPattern.active is true, you MUST address it specifically.
- If transitionPattern.type is Post-Peak Divergence, explain that the DA/PLD compound gap widened after convergence or near-convergence while air-density trend rose and PLD fell.
- If transitionPattern.type is Inverse Post-Peak Divergence, explain that the compound gap widened in the opposite direction while air-density trend eased and PLD rose.
- If transitionPattern.flipFlop.active is true or transitionPattern.transitionPattern is Flip-Flop Transition, explain that PPD and Inverse PPD both occurred in the rolling window and the body response may feel mixed or changeable by profile.
- Mention compoundGapChange, densityNormSlope, pldNormSlope, pldSlope, densitySlope, nearConvergence, and source if provided.
- If no transition is active, say no active DA/PLD divergence pattern was flagged.

BP/body rules:
- If BP profile is high, emphasize DA burden, density load, exertion caution, and using a real cuff/device.
- If BP profile is low or narrow pulse pressure is provided, emphasize transition windows, lightheadedness caution, and gentle pacing.
- If BP profile is average, keep tone moderate and avoid overstating risk.
- Mention that higher-BP, lower-BP, narrow-pulse-pressure, fatigue-sensitive, sinus/dental-pressure, or sensitive profiles may respond differently if relevant.

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
flipFlopActive: ${flipActive}

transitionPattern:
${JSON.stringify(transition, null, 2)}

flipFlop:
${JSON.stringify(flip, null, 2)}

Full app payload:
${JSON.stringify(payload, null, 2)}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
