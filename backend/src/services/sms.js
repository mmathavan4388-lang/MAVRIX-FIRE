import { config, flags } from '../config.js';
import { unavailable } from '../util/http.js';

/** Sends an OTP via MSG91 (DLT-registered template required in India). */
export async function sendOtpSms(phone, code) {
  if (!flags.sms()) throw unavailable('sms_not_configured', 'Mobile OTP is not configured on the server');
  const mobile = phone.replace(/^\+/, '').replace(/^(\d{10})$/, '91$1');
  const res = await fetch('https://control.msg91.com/api/v5/otp?' + new URLSearchParams({
    template_id: config.sms.msg91TemplateId, mobile, otp: code,
  }), { method: 'POST', headers: { authkey: config.sms.msg91AuthKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.type === 'error') { console.error('[msg91]', res.status, j); throw unavailable('sms_failed', 'Could not send OTP. Please retry.'); }
}
