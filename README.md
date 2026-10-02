# MAVRIX FIRE

Multi-vendor fireworks marketplace — Sivakasi first. **from SAYRIX MATHAV**

One repository, one deployable service:

| Part | Tech | Where |
|---|---|---|
| API + business rules | Node 22, Express, PostgreSQL (SQL migrations) | `backend/` |
| Customer app, Seller dashboard, Admin panel | React + Vite, mobile-first, Tamil / Hindi / English | `web/` |
| Android app | Capacitor wrapper around the same web app | `web/capacitor.config.json` |
| Ops | Dockerfile, compose, backup script, CI | repo root, `ops/`, `.github/` |

Everything is real: Postgres tables with constraints, server-side authorization, server-verified payments,
automatic 5 % commission and split settlement, cloud image storage. Nothing is mocked or hard-coded; no data
is seeded except reference data (the Sivakasi city row, the fireworks categories, platform settings).

## Run locally

```bash
cp .env.example .env            # fill DATABASE_URL and ADMIN_SETUP_TOKEN at minimum
npm install
npm run migrate                 # creates / upgrades the schema (also runs automatically on server start)
npm run dev:api                 # API on :8080
npm run dev:web                 # web on :5173 (proxies /api to :8080)
```

Open `http://localhost:5173/admin/setup` once to create the single Admin account (needs `ADMIN_SETUP_TOKEN`).
Features whose credentials are missing (payments, image upload, SMS OTP, Google sign-in) answer with a clear
"not configured" message instead of pretending to work — see **DEPLOYMENT.md** for the exact list.

```bash
npm test                        # end-to-end backend tests against a real Postgres (TEST_DATABASE_URL)
npm -w web run check:i18n       # every UI string exists in Tamil, Hindi and English
```

## How the money works

1. Customer checks out (cart may contain several shops). The server re-prices every line, **reserves stock atomically**
   and splits the order into one **sub-order per seller**, each with its own commission (`round(subtotal × 5 %)`).
2. The server creates **one Razorpay order with Route transfers** (one per seller = subtotal − commission, held).
   Only UPI is offered; any other method that slips through is auto-refunded.
3. The Razorpay **webhook** (HMAC-SHA256 verified, idempotent) — or the server-side `/payments/verify`, which re-fetches
   the payment from Razorpay — marks the order paid, writes settlement rows, notifies buyer / sellers / admin.
   The browser's "success" callback alone never marks anything paid.
4. Funds stay **on hold** at Razorpay until the seller marks the sub-order delivered / picked up, then the transfer is released
   automatically (retried by a background job if Razorpay is unreachable).
5. Abandoned checkouts release their reserved stock after `order_hold_minutes`.

Seller plan: ₹199 / 6 months (paid through the same gateway). Shops are publicly listed only while
**approved + plan active + payout account active**.

## Security model

- One admin only: a partial unique index makes a second admin impossible; first-admin setup requires `ADMIN_SETUP_TOKEN`
  and closes permanently. Admin has its own login endpoint, 30-min idle timeout, optional TOTP 2FA, "log out everywhere",
  rate limits and an append-only audit log (DB triggers forbid edits/deletes).
- Passwords: scrypt. Sessions: opaque random tokens, stored hashed, revocable server-side.
- Every route is role-checked on the server; sellers can only touch their own shop's rows.
- Secrets only via environment variables; Razorpay secret never reaches the browser; bank/PAN details are forwarded to
  Razorpay and **not stored** by MAVRIX FIRE.
- Uploads are re-encoded server-side (WebP, EXIF stripped) and scoped to per-owner folders.
- Nothing is hard-deleted: users, shops, products, banners and categories use soft-delete/deactivation; orders,
  payments, refunds, settlements and support history are retained.

## Updates every 6 months without losing data

Schema changes are **new numbered SQL files** in `backend/migrations/` (`003_….sql`, …). The runner applies only the
ones not yet applied, checksums applied files (editing an old one is refused), and takes an advisory lock so two
instances can't race. Deploy new code → it migrates on boot. Take a backup first (`ops/backup.sh`) and keep API changes
additive so the previous Android build keeps working.

## Not built (be aware)

- **Push notifications (FCM)** — notifications are stored and shown in-app (badge refreshes every 30 s). Add FCM in `services/notify.js`.
- **Forgot-password by email** — no email provider is wired. Customers can sign in by SMS OTP once MSG91 is configured.
- **Delivery partners** — the order model supports delivery states, but delivery is disabled platform-wide until the admin enables it.
