// /api/verify-session.js
// Verifies a Stripe Checkout Session from a Payment Link success redirect.
// Required Vercel environment variable:
// STRIPE_SECRET_KEY=sk_live_...

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

    if (!stripeKey) {
      return res.status(500).json({ ok: false, error: "Server is missing STRIPE_SECRET_KEY" });
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
      return res.status(400).json({
        ok: false,
        error: session?.error?.message || "Could not retrieve Stripe session",
      });
    }

    const paid = session.payment_status === "paid" || session.status === "complete";
    const isSubscription = session.mode === "subscription";

    if (!paid) {
      return res.status(402).json({
        ok: false,
        error: "Payment is not complete",
        status: session.status,
        payment_status: session.payment_status,
      });
    }

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      customerEmail: session.customer_details?.email || null,
      amountTotal: session.amount_total || null,
      currency: session.currency || null,
      mode: session.mode || null,
      isSubscription,
      allowDownload: !isSubscription,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Server verification error",
    });
  }
}
