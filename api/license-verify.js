export default async function handler(req, res) {
  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
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

    const body = req.body || {};
    const licenseKey = String(body.licenseKey || "").trim();
    const deviceId = String(body.deviceId || "").trim();

    if (!licenseKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey."
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: "Missing deviceId."
      });
    }

    // 1. Look up license
    const licenseUrl =
      `${SUPABASE_URL}/rest/v1/licenses` +
      `?license_key=eq.${encodeURIComponent(licenseKey)}` +
      `&select=*`;

    const licenseResp = await fetch(licenseUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!licenseResp.ok) {
      const text = await licenseResp.text();
      return res.status(500).json({
        ok: false,
        error: "Supabase license lookup failed.",
        details: text
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

    // 2. Check existing activations for this license
    const activationsUrl =
      `${SUPABASE_URL}/rest/v1/license_activations` +
      `?license_key=eq.${encodeURIComponent(licenseKey)}` +
      `&select=*`;

    const activationsResp = await fetch(activationsUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!activationsResp.ok) {
      const text = await activationsResp.text();
      return res.status(500).json({
        ok: false,
        error: "Supabase activation lookup failed.",
        details: text
      });
    }

    const activations = await activationsResp.json();

    const existingDevice = activations.find(
      a => String(a.device_id) === deviceId
    );

    // Existing device can continue using the license
    if (existingDevice) {
      return res.status(200).json({
        ok: true,
        valid: true,
        status: "already_activated",
        license: {
          licenseKey: license.license_key,
          product: license.product,
          plan: license.plan,
          customerEmail: license.customer_email,
          deviceLimit: deviceLimit,
          activationCount: activations.length
        }
      });
    }

    // New device, but limit reached
    if (activations.length >= deviceLimit) {
      return res.status(403).json({
        ok: false,
        valid: false,
        reason: "DEVICE_LIMIT_REACHED",
        deviceLimit: deviceLimit,
        activationCount: activations.length
      });
    }

    // 3. Register this device
    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/license_activations`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        license_key: licenseKey,
        device_id: deviceId,
        activated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      })
    });

    if (!insertResp.ok) {
      const text = await insertResp.text();
      return res.status(500).json({
        ok: false,
        error: "Could not register activation.",
        details: text
      });
    }

    // 4. Update activation count on license
    await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          activation_count: activations.length + 1,
          updated_at: new Date().toISOString()
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
        deviceLimit: deviceLimit,
        activationCount: activations.length + 1
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "License verification server error.",
      details: err.message
    });
  }
}
