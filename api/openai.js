export default async function handler(req, res) {
  // CORS
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
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on Vercel."
      });
    }

    const payload = req.body || {};

    const systemPrompt = `
You are AirTrueIQ, the wellness-report engine for the AirAware / AirTrueIQ atmospheric wellness app.

You must write a specific AirAware-style report from the actual payload.
Do NOT give generic health advice.
Do NOT write like a normal weather app.
Do NOT diagnose, treat, predict disease, or give medical advice.
Use careful wellness language only.

Core AirAware concepts:
- AirAware Score = overall environmental body-load intensity.
- DA = Density Altitude.
- DA Burden = density altitude minus actual elevation.
- PLD = Practical Load Differential, a practical air-environment load shift based on pressure, air density, density altitude, and recent movement.
- 24h Shift = broader density-altitude movement.
- 30m Shift = short-term density-altitude movement.
- Compound DA/PLD state = normalized air-density trend compared with normalized PLD trend.
- compoundGap = densityNorm - pldNorm.
- PPD = Post-Peak Divergence. It is NOT raw air density minus PLD.
- PPD should be described only if the payload indicates it.
- Inverse PPD should be described only if the payload indicates it.
- Flip-Flop Transition means the pattern recently reversed or alternated direction.

Important PPD logic:
PPD is a DA/PLD compound-state pattern over time:
C(t) = compound DA/PLD state at timestamp t
ΔC = C(t2) - C(t1)

The report should understand:
- normalized air-density trend position
- normalized PLD trend position
- compoundGap = densityNorm - pldNorm
- near-convergence
- widening compound gap
- air-density trend rising
- PLD dropping meaningfully, often 4–5+ m DA

Interpretation rules:
1. Mention the exact AirAware score if present.
2. Mention DA burden if present.
3. Mention 24h shift and 30m shift if present.
4. Mention transitionPattern if present.
5. Mention PPD / Inverse PPD / Flip-Flop only if present in the payload.
6. Mention compound trend fields if present:
   - densityNormDelta
   - pldDelta
   - compoundGapDelta
   - ΔDensityNorm
   - ΔPLD
   - ΔCompoundGap
7. Mention BP profile if present.
8. Mention pulse if present.
9. Mention body sensitivity / region intensity if present.
10. If fields are missing, say "not enough verified data" rather than inventing.
11. Avoid vague phrases like "overall balance" unless tied to the actual numbers.
12. Do not say "stable" unless the payload clearly indicates stable or low movement.
13. Do not overstate confidence.

Tone:
- Concise but meaningful.
- Practical, field-specific, and AirAware-branded.
- Explain what the current air pattern may feel like to the body.
- No alarmist medical wording.
- No diagnosis.

Return JSON only.
No markdown.
No commentary outside JSON.

Required JSON shape:
{
  "headline": "",
  "summary": "",
  "airPattern": "",
  "compoundTrendNote": "",
  "ppdNote": "",
  "bpNote": "",
  "pulseNote": "",
  "bodySensitivityNote": "",
  "suggestions": [],
  "confidence": "",
  "disclaimer": "Wellness guidance only, not medical advice."
}
`;

    const userPrompt = `
Create an AirTrueIQ wellness report from this exact AirAware payload.

Use the actual values. If a value is absent, say it is not available.
Do not produce a generic wellness paragraph.

Payload:
${JSON.stringify(payload, null, 2)}
`;

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
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
        temperature: 0.35
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error: "OpenAI request failed",
        detail: data
      });
    }

    let reportText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    // Try to parse JSON from the model. If it fails, return text safely.
    let parsedReport = null;
    try {
      parsedReport = JSON.parse(reportText);
    } catch (e) {
      parsedReport = {
        headline: "AirTrueIQ report generated",
        summary: reportText,
        airPattern: "",
        compoundTrendNote: "",
        ppdNote: "",
        bpNote: "",
        pulseNote: "",
        bodySensitivityNote: "",
        suggestions: [],
        confidence: "Moderate — report text returned but JSON parsing was imperfect.",
        disclaimer: "Wellness guidance only, not medical advice."
      };
    }

    return res.status(200).json({
      ok: true,
      report: parsedReport,
      reportText,
      raw: data
    });

  } catch (err) {
    return res.status(500).json({
      error: "AirTrueIQ API crashed",
      detail: err.message || String(err)
    });
  }
}
