import { Router } from 'express';
import { one, query } from '../db.js';
import { verifyWebhookSignature } from '../services/razorpay.js';
import { handlePaymentCaptured, handlePaymentFailed } from '../services/orders.js';
import { notify } from '../services/notify.js';

export const webhooks = Router();

const ACCOUNT_MAP = { 'account.activated': 'active', 'account.instantly_activated': 'active', 'account.activated_kyc_pending': 'active',
  'account.needs_clarification': 'needs_clarification', 'account.rejected': 'rejected', 'account.under_review': 'pending' };

// Raw body is required: the signature is computed over the exact bytes Razorpay sent.
webhooks.post('/razorpay', async (req, res) => {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'bad_signature' });
  let evt;
  try { evt = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json' }); }
  const eventId = req.get('x-razorpay-event-id') || `${evt.event}:${evt.payload?.payment?.entity?.id ?? evt.payload?.transfer?.entity?.id ?? evt.created_at}`;

  const seen = await one(`insert into webhook_events (id, type, payload) values ($1,$2,$3)
                          on conflict (id) do update set type = excluded.type returning processed_at`, [eventId, evt.event, evt]);
  if (seen.processed_at) return res.json({ ok: true, duplicate: true });

  try {
    const p = evt.payload || {};
    switch (evt.event) {
      case 'payment.captured':
      case 'order.paid':
        if (p.payment?.entity) await handlePaymentCaptured(p.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(p.payment.entity);
        break;
      case 'transfer.processed': {
        const t = p.transfer?.entity;
        if (t?.id) await query(`update settlements set status = 'settled', settled_at = now() where razorpay_transfer_id = $1 and status in ('released','on_hold')`, [t.id]);
        break;
      }
      case 'transfer.failed': {
        const t = p.transfer?.entity;
        if (t?.id) await query(`update settlements set status = 'failed' where razorpay_transfer_id = $1`, [t.id]);
        break;
      }
      case 'refund.processed':
      case 'refund.failed': {
        const r = p.refund?.entity;
        if (r?.id) await query(`update refunds set status = $2 where razorpay_refund_id = $1`, [r.id, evt.event === 'refund.processed' ? 'processed' : 'failed']);
        break;
      }
      default:
        if (ACCOUNT_MAP[evt.event]) {
          const a = p.account?.entity;
          const shop = a?.id && await one('update shops set payout_status = $2 where razorpay_account_id = $1 returning owner_id', [a.id, ACCOUNT_MAP[evt.event]]);
          if (shop) await notify(shop.owner_id, 'payout_status', { status: ACCOUNT_MAP[evt.event] });
        }
    }
    await query('update webhook_events set processed_at = now(), error = null where id = $1', [eventId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook]', evt.event, e);
    await query('update webhook_events set error = $2 where id = $1', [eventId, String(e.message).slice(0, 500)]).catch(() => {});
    res.status(500).json({ error: 'processing_failed' });   // Razorpay retries; handlers are idempotent
  }
});
