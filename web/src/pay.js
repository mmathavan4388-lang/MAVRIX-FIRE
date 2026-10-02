// Razorpay Standard Checkout (UPI only; options are built server-side). The client never decides a payment succeeded:
// after the sheet reports success it calls the backend /payments/verify, which re-checks signature and gateway state.
let loading;
function loadScript() {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    s.onload = res; s.onerror = () => { loading = null; rej(new Error('script')); };
    document.head.appendChild(s);
  });
  return loading;
}
export async function payWithRazorpay(options) {
  await loadScript();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      ...options,
      handler: (r) => resolve(r),
      modal: { ondismiss: () => reject(Object.assign(new Error('dismissed'), { dismissed: true })), confirm_close: true },
    });
    rz.on('payment.failed', (r) => reject(Object.assign(new Error(r?.error?.description || 'failed'), { failed: true })));
    rz.open();
  });
}
