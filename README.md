# AirTrueIQ Secure Download Package

Upload these files/folders to the root of your `airtrueiq-site` GitHub repo:

```text
success.html
api/
  verify-session.js
  download-apk.js
```

## Vercel Environment Variables

In Vercel project settings, add:

```text
STRIPE_SECRET_KEY=sk_live_...
AIRAWARE_APK_URL=https://your-secure-apk-location.example.com/airaware.apk
```

## Stripe Payment Link Redirect

For the Basic App Payment Link, set After Payment / Confirmation behavior to redirect to:

```text
https://airtrueiq.com/success.html?session_id={CHECKOUT_SESSION_ID}
```

For Premium Monthly and Annual, you may also redirect to the same success page,
but the page will not show the APK download button for subscription sessions.

## Security Note

This verifies the Stripe Checkout Session before showing the APK download action.
For true secure APK delivery, do not store the APK as a public file in the GitHub repo.
Use private storage or signed URL storage and set that URL as `AIRAWARE_APK_URL`.

Stripe documentation confirms `{CHECKOUT_SESSION_ID}` can be included in redirect URLs
for Payment Links and Checkout, and also says webhooks are required for reliable fulfillment.
