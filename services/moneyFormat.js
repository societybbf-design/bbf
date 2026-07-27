/**
 * Server-side BDT (Taka) display formatting for PDFs, emails, and messages.
 */
const CURRENCY_SYMBOL = '৳';

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (value == null || value === '') return 0;
  const cleaned = String(value).replace(/[৳$,\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value, digits = 2) {
  const num = toNumber(value);
  const places = Number.isFinite(Number(digits)) ? Number(digits) : 2;
  return `${CURRENCY_SYMBOL}${num.toLocaleString('en-BD', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}

/** PDF-safe money label. Prefer calling after preparePdfDocument/usePdfBodyFont so ৳ embeds. */
function formatPdfMoney(value, digits = 2) {
  return formatMoney(value, digits);
}

module.exports = {
  CURRENCY_SYMBOL,
  formatMoney,
  formatPdfMoney,
  toNumber,
};
