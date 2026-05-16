// /api/download-apk.js
// Securely verifies a paid Stripe Checkout Session before sending the APK.
// Required Vercel environment variables:
// STRIPE_SECRET_KEY=sk_live_...
// AIRAWARE_APK_URL=https://your-secure-apk-location.example.com/airaware.apk
//
// IMPORTANT:
// For true security, AIRAWARE_APK_URL should point to private/signed storage
// or a controlled download source. Do not expose the APK in your public repo
// if you want it protected.

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("Method not allowed");
    }

    const sessionId = req.query.session_id;

    if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return res.status(400).send("Invalid or missing checkout session ID");
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const apkUrl = process.env.AIRAWARE_APK_URL;

    if (!stripeKey) {
      return res.status(500).send("Server is missing STRIPE_SECRET_KEY");
    }

    if (!apkUrl) {
      return res.status(500).send("Server is missing AIRAWARE_APK_URL");
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
        },
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return res.status(400).send(session?.error?.message || "Could not verify payment");
    }

    const paid = session.payment_status === "paid" || session.status === "complete";
    const isSubscription = session.mode === "subscription";

    if (!paid) {
      return res.status(402).send("Payment is not complete");
    }

    if (isSubscription) {
      return res.status(403).send("This session is for a Premium subscription, not APK download.");
    }

    // Redirect to the configured APK location after payment verification.
    // Best production option: make this a signed/expiring URL from private storage.
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, apkUrl);
  } catch (error) {
    return res.status(500).send("Secure download error");
  }
}
