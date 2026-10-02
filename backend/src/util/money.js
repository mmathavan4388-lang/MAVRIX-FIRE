// Integer paise arithmetic only.
export const commissionFor = (subtotalPaise, bps) => Math.round((subtotalPaise * bps) / 10000);
export const rupees = (paise) => (paise / 100).toFixed(2);
