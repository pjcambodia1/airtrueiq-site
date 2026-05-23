// /api/verify-session.js
// Verifies Stripe Checkout Session and creates ONE AirAware license per paid Stripe session.

import crypto from "crypto";

function makeLicenseKey() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `AIR-${part()}-${part()}-${part()}-${part()}`;
}

async function supabaseFetch(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const sessionId = req.query.session_id;

    if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return res.status(400).json({ ok: false, error: "Invalid or missing checkout session ID" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeKey) {
      return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
    }

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ ok: false, error: "Missing Supabase environment variables" });
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeKey}`
        }
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return res.status(400).json({
        ok: false,
        error: session?.error?.message || "Could not retrieve Stripe session"
      });
    }

    const paid = session.payment_status === "paid" || session.status === "complete";

    if (!paid) {
      return res.status(402).json({
        ok: false,
        error: "Payment is not complete",
        status: session.status,
        payment_status: session.payment_status
      });
    }

    const email =
      session.customer_details?.email ||
      session.customer_email ||
      null;

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Stripe session has no customer email"
      });
    }

    // 1. If this Stripe session already has a license, return the same license.
    const existingResp = await supabaseFetch(
      `/rest/v1/licenses?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=*`,
      { method: "GET" }
    );

    const existingLicenses = await existingResp.json();

    if (Array.isArray(existingLicenses) && existingLicenses.length > 0) {
      const existing = existingLicenses[0];

      return res.status(200).json({
        ok: true,
        alreadyCreated: true,
        sessionId: session.id,
        customerEmail: email,
        amountTotal: session.amount_total || null,
        currency: session.currency || null,
        allowDownload: true,
        license: {
          licenseKey: existing.license_key,
          product: existing.product,
          plan: existing.plan,
          status: existing.status,
          deviceLimit: existing.device_limit
        }
      });
    }

    // 2. Upsert customer.
    await supabaseFetch(`/rest/v1/customers?on_conflict=email`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        email,
        name: session.customer_details?.name || null,
        stripe_customer_id: session.customer || null,
        updated_at: new Date().toISOString()
      })
    });

    // 3. Create one unique license for this paid session.
    let createdLicense = null;

    for (let i = 0; i < 5; i++) {
      const licenseKey = makeLicenseKey();

      const insertResp = await supabaseFetch(`/rest/v1/licenses`, {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          license_key: licenseKey,
          customer_email: email,
          product: "airaware",
          plan: "basic",
          status: "active",
          device_limit: 1,
          activation_count: 0,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent || null,
          notes: "Created automatically from Stripe success page"
        })
      });

      if (insertResp.ok) {
        const rows = await insertResp.json();
        createdLicense = rows[0];
        break;
      }
    }

    if (!createdLicense) {
      return res.status(500).json({
        ok: false,
        error: "Could not create license"
      });
    }

    // 4. Store payment record.
    await supabaseFetch(`/rest/v1/payments`, {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        customer_email: email,
        license_key: createdLicense.license_key,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent || null,
        amount_total: session.amount_total || null,
        currency: session.currency || null,
        payment_status: session.payment_status || null,
        raw: session
      })
    });

    return res.status(200).json({
      ok: true,
      alreadyCreated: false,
      sessionId: session.id,
      customerEmail: email,
      amountTotal: session.amount_total || null,
      currency: session.currency || null,
      allowDownload: true,
      license: {
        licenseKey: createdLicense.license_key,
        product: createdLicense.product,
        plan: createdLicense.plan,
        status: createdLicense.status,
        deviceLimit: createdLicense.device_limit
      }
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Server verification error",
      detail: error.message || String(error)
    });
  }
}
