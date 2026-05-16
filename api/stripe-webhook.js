// api/stripe-webhook.js
// AirTrueIQ Stripe webhook endpoint for Vercel.
//
// Required Vercel environment variables:
// STRIPE_SECRET_KEY=sk_live_...
// STRIPE_WEBHOOK_SECRET=whsec_...
//
// Stripe webhook endpoint URL:
// https://airtrueiq.com/api/stripe-webhook
//
// Required Stripe event:
// checkout.session.completed
//
// Optional useful events:
// invoice.payment_succeeded
// invoice.payment_failed
// customer.subscription.created
// customer.subscription.updated
// customer.subscription.deleted

import { buffer } from "micro";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;

  const parts = signatureHeader.split(",");
  let timestamp = "";
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(expectedSignature, "hex")
      );
    } catch {
      return false;
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
  }

  let rawBodyBuffer;

  try {
    rawBodyBuffer = await buffer(req);
  } catch (error) {
    return res.status(400).send("Could not read request body");
  }

  const rawBody = rawBodyBuffer.toString("utf8");
  const signatureHeader = req.headers["stripe-signature"];

  const verified = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);

  if (!verified) {
    return res.status(400).send("Invalid Stripe signature");
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).send("Invalid JSON");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const mode = session.mode;
        const paymentStatus = session.payment_status;
        const customerEmail =
          session.customer_details?.email || session.customer_email || null;
        const amountTotal = session.amount_total;
        const currency = session.currency;
        const sessionId = session.id;

        console.log("AirTrueIQ checkout completed:", {
          sessionId,
          mode,
          paymentStatus,
          customerEmail,
          amountTotal,
          currency,
        });

        // Future fulfillment:
        // if mode === "payment", grant APK access or email download link.
        // if mode === "subscription", grant Premium membership access.
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        console.log("AirTrueIQ invoice payment succeeded:", {
          invoiceId: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log("AirTrueIQ invoice payment failed:", {
          invoiceId: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log("AirTrueIQ subscription event:", {
          type: event.type,
          subscriptionId: subscription.id,
          status: subscription.status,
          customer: subscription.customer,
        });
        break;
      }

      default:
        console.log(`AirTrueIQ webhook received unhandled event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("AirTrueIQ webhook handler error:", error);
    return res.status(500).send("Webhook handler error");
  }
}
