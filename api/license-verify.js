export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase environment variables."
      });
    }

    const licenseKey = String(req.body?.licenseKey || "").trim();
    const deviceId = String(req.body?.deviceId || "").trim();
    const appVersion = String(req.body?.appVersion || "").trim();

    if (!licenseKey) {
      return res.status(400).json({ ok: false, error: "Missing licenseKey." });
    }

    if (!deviceId) {
      return res.status(400).json({ ok: false, error: "Missing deviceId." });
    }

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };

    const licenseResp = await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}&select=*`,
      { method: "GET", headers }
    );

    if (!licenseResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase license lookup failed.",
        details: await licenseResp.text()
      });
    }

    const licenses = await licenseResp.json();
    const license = Array.isArray(licenses) ? licenses[0] : null;

    if (!license) {
      return res.status(404).json({
        ok: false,
        valid: false,
        reason: "LICENSE_NOT_FOUND"
      });
    }

    if (license.status !== "active") {
      return res.status(403).json({
        ok: false,
        valid: false,
        reason: "LICENSE_NOT_ACTIVE",
        status: license.status
      });
    }

    const deviceLimit = Number(license.device_limit || 1);

    const activationsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/activations?license_key=eq.${encodeURIComponent(licenseKey)}&select=*`,
      { method: "GET", headers }
    );

    if (!activationsResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase activation lookup failed.",
        details: await activationsResp.text()
      });
    }

    const activations = await activationsResp.json();

    const existingDevice = activations.find(
      a => String(a.device_id) === deviceId && String(a.status || "active") === "active"
    );

    if (existingDevice) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/activations?id=eq.${encodeURIComponent(existingDevice.id)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            last_seen_at: new Date().toISOString(),
            app_version: appVersion || existingDevice.app_version || null
          })
        }
      );

      return res.status(200).json({
        ok: true,
        valid: true,
        status: "already_activated",
        license: {
          licenseKey: license.license_key,
          product: license.product,
          plan: license.plan,
          customerEmail: license.customer_email,
          deviceLimit,
          activationCount: activations.length
        }
      });
    }

    const activeActivations = activations.filter(
      a => String(a.status || "active") === "active"
    );

    if (activeActivations.length >= deviceLimit) {
      return res.status(403).json({
        ok: false,
        valid: false,
        reason: "DEVICE_LIMIT_REACHED",
        deviceLimit,
        activationCount: activeActivations.length
      });
    }

    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/activations`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        license_key: licenseKey,
        device_id: deviceId,
        app_version: appVersion || null,
        platform: "android",
        status: "active",
        activated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      })
    });

    if (!insertResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Could not register activation.",
        details: await insertResp.text()
      });
    }

    const newActivationCount = activeActivations.length + 1;

    await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          activation_count: newActivationCount
        })
      }
    );

    return res.status(200).json({
      ok: true,
      valid: true,
      status: "activated",
      license: {
        licenseKey: license.license_key,
        product: license.product,
        plan: license.plan,
        customerEmail: license.customer_email,
        deviceLimit,
        activationCount: newActivationCount
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "License verification server error.",
      details: err.message || String(err)
    });
  }
}

