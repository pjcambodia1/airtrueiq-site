// /api/license-verify.js
// AirTrueIQ / AirAware license verification endpoint
// POST only. Uses Supabase REST API from Vercel server side.
// Required Vercel env vars:
// SUPABASE_URL = https://YOUR_PROJECT_REF.supabase.co
// SUPABASE_SERVICE_ROLE_KEY = sb_secret_... OR service_role JWT

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

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
        error: "Missing Supabase environment variables"
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const licenseKeyRaw = body.licenseKey || body.license_key || body.key || "";
    const deviceIdRaw = body.deviceId || body.device_id || "";
    const appVersion = body.appVersion || body.app_version || "unknown";

    const licenseKey = String(licenseKeyRaw).trim().toUpperCase();
    const deviceId = String(deviceIdRaw).trim();

    if (!licenseKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey"
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: "Missing deviceId"
      });
    }

    const baseUrl = SUPABASE_URL.replace(/\/+$/, "");

    // Correct Supabase REST path
    const lookupUrl =
      `${baseUrl}/rest/v1/licenses` +
      `?license_key=eq.${encodeURIComponent(licenseKey)}` +
      `&select=id,license_key,customer_email,product,plan,status,device_limit,activation_count,created_at,notes`;

    const lookupResp = await fetch(lookupUrl, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const lookupText = await lookupResp.text();

    if (!lookupResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase license lookup failed",
        status: lookupResp.status,
        details: lookupText,
        lookupUrlUsed: lookupUrl.replace(SUPABASE_SERVICE_ROLE_KEY, "[hidden]")
      });
    }

    let rows = [];
    try {
      rows = JSON.parse(lookupText);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Could not parse Supabase lookup response",
        details: lookupText
      });
    }

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        valid: false,
        error: "License not found"
      });
    }

    const license = rows[0];

    if (license.status !== "active") {
      return res.status(403).json({
        ok: false,
        valid: false,
        error: "License is not active",
        status: license.status
      });
    }

    // Check existing activation for this license/device
    const activationLookupUrl =
      `${baseUrl}/rest/v1/license_activations` +
      `?license_id=eq.${encodeURIComponent(license.id)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}` +
      `&select=id,license_id,device_id,activated_at,last_seen_at,app_version`;

    const activationResp = await fetch(activationLookupUrl, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const activationText = await activationResp.text();

    if (!activationResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase activation lookup failed",
        status: activationResp.status,
        details: activationText
      });
    }

    let activations = [];
    try {
      activations = JSON.parse(activationText);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Could not parse activation lookup response",
        details: activationText
      });
    }

    const alreadyActivated = activations.length > 0;

    if (alreadyActivated) {
      // Update last seen
      await fetch(`${baseUrl}/rest/v1/license_activations?id=eq.${encodeURIComponent(activations[0].id)}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          last_seen_at: new Date().toISOString(),
          app_version: appVersion
        })
      });

      return res.status(200).json({
        ok: true,
        valid: true,
        status: "already_activated",
        license: {
          licenseKey: license.license_key,
          product: license.product,
          plan: license.plan,
          deviceLimit: license.device_limit,
          activationCount: license.activation_count
        }
      });
    }

    const currentCount = Number(license.activation_count || 0);
    const deviceLimit = Number(license.device_limit || 1);

    if (currentCount >= deviceLimit) {
      return res.status(403).json({
        ok: false,
        valid: false,
        error: "Device limit reached",
        activationCount: currentCount,
        deviceLimit
      });
    }

    // Insert new activation
    const insertActivationResp = await fetch(`${baseUrl}/rest/v1/license_activations`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        license_id: license.id,
        device_id: deviceId,
        app_version: appVersion,
        activated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      })
    });

    const insertActivationText = await insertActivationResp.text();

    if (!insertActivationResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase activation insert failed",
        status: insertActivationResp.status,
        details: insertActivationText
      });
    }

    // Update activation count
    const newCount = currentCount + 1;

    const updateLicenseResp = await fetch(`${baseUrl}/rest/v1/licenses?id=eq.${encodeURIComponent(license.id)}`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        activation_count: newCount
      })
    });

    const updateLicenseText = await updateLicenseResp.text();

    if (!updateLicenseResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase license activation count update failed",
        status: updateLicenseResp.status,
        details: updateLicenseText
      });
    }

    return res.status(200).json({
      ok: true,
      valid: true,
      status: "activated",
      license: {
        licenseKey: license.license_key,
        product: license.product,
        plan: license.plan,
        deviceLimit: deviceLimit,
        activationCount: newCount
      }
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: err.message || String(err)
    });
  }
}
