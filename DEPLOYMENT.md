# Deployment checklist

## 0. Read these two things first — they can block the business, not just the code

**1. Payment provider category.** Razorpay (and most Indian gateways) restrict or prohibit explosives / fireworks
merchants. Before building on it, ask Razorpay in writing whether a *marketplace selling fireworks* is permitted on
Route. If not, the payment layer is isolated in `backend/src/services/razorpay.js` and `orders.js` / `webhooks.js`
and can be re-implemented for a provider that allows the category.

**2. Law.** Selling, storing, transporting and delivering fireworks is regulated (Explosives Act/Rules 2008, PESO licences,
Supreme Court orders on firecrackers incl. restrictions on online sale, state/municipal rules, green-cracker rules).
Get legal advice for the exact flow (online order + shop pickup vs. delivery). The app gives you the controls:
`checkout_enabled` kill-switch, delivery off by default, age confirmation + safety acknowledgement stored on every order,
admin approval of every seller and product, city allow-list (`cities.is_active`). It does not decide what is lawful.

## 1. Accounts / credentials you must provide

| What | Used for | Env vars |
|---|---|---|
| PostgreSQL (Supabase, Neon, RDS…) | all data | `DATABASE_URL`, `DATABASE_SSL` |
| Razorpay account with **Route** enabled | UPI payments, 5 % split, seller payouts, ₹199 plan | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| S3-compatible bucket + public/CDN URL | product / shop / support images | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| A random secret you invent | one-time First Admin Setup | `ADMIN_SETUP_TOKEN` (`openssl rand -base64 32`) |
| Domain + HTTPS hosting (Render / Fly.io / Railway / VPS) | the service | `PUBLIC_URL`, `TRUST_PROXY=true`, `CORS_ORIGINS` |
| *(optional)* Google Cloud OAuth Web client | "Sign in with Google" | `GOOGLE_CLIENT_ID` |
| *(optional)* MSG91 + DLT-approved OTP template | mobile OTP login / verification | `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` |
| Google Play developer account (US$25 once) | Play Store | — |

All variables are documented in `.env.example`. Never commit a real `.env`.

## 2. Razorpay setup

1. Dashboard → enable **Route**; use `rzp_test_*` keys first.
2. Settings → Payment methods: leave **UPI** on; turn **cards, netbanking, wallets, EMI, pay-later off** (the app also
   auto-refunds any non-UPI payment). Keep **auto-capture** on.
3. Webhooks → add `https://<your-domain>/api/webhooks/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`, events:
   `payment.captured`, `payment.failed`, `order.paid`, `transfer.processed`, `transfer.failed`, `refund.processed`, `refund.failed`,
   `account.activated`, `account.instantly_activated`, `account.activated_kyc_pending`, `account.needs_clarification`, `account.rejected`, `account.under_review`.
4. Make one end-to-end test purchase with a second seller account before going live.

## 3. Deploy the service

```bash
docker build -t mavrix-fire .
docker run -p 8080:8080 --env-file .env mavrix-fire     # or push to Render / Fly / Railway (Dockerfile detected)
```
The container migrates the database on start, serves the API at `/api`, the web app at `/`, health at `/healthz`.
Terminate TLS at the host (HTTPS is mandatory; HSTS is sent in production). Run **one or more** instances — jobs are
idempotent and advisory-locked.

Then open `https://<domain>/admin/setup`, enter your admin email, a **new** app admin password (never your Gmail password)
and the `ADMIN_SETUP_TOKEN`. Setup closes forever. Enable 2FA under *Settings & security*.

## 4. Logo

Put the official logo at **`web/public/brand/logo.png`** (square PNG, ≥512 px) and rebuild. It is used unmodified on the
splash, headers and as the app icon. Until then the UI shows the text "MAVRIX FIRE" — no substitute logo is drawn.

## 5. Android app (Google Play)

```bash
cd web
echo "VITE_API_URL=https://<your-domain>" > .env.production     # the app talks to your hosted API
npm run build
npx cap add android            # once; creates web/android/
npx cap sync android
npx cap open android           # Android Studio → generate icons from the logo → Build → Signed Bundle (.aab)
```
`appId` is `com.sayrix.mavrixfire` (change in `capacitor.config.json` before first upload — it cannot change later).
Add `https://localhost` to `CORS_ORIGINS`. Upload the `.aab` in Play Console; fireworks apps need the Play "Restricted content"
declaration — check Play policy for your exact flow before submitting.

## 6. Backups

- Turn on the database provider's automatic daily backups / PITR.
- Additionally schedule `ops/backup.sh` (daily) and copy dumps to separate storage. Test a restore once.
- Images live in your bucket — enable versioning there.

## 7. Release process (every ~6 months)

`git tag v1.1.0` → CI (tests + i18n check + build) → `ops/backup.sh` → deploy. New schema = new `backend/migrations/00N_*.sql`
(additive; never edit applied files). Customers, sellers, products, orders, payments, reviews and support history persist.
