/**
 * Shared BDT (Taka) money formatting for Bondhutto-er Bandhon Foundation UI.
 */
(function initSocietyMoney(global) {
  const SYMBOL = '৳';

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
    return `${SYMBOL}${num.toLocaleString('en-BD', {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    })}`;
  }

  global.formatMoney = formatMoney;
  global.SocietyMoney = {
    symbol: SYMBOL,
    format: formatMoney,
    toNumber,
  };
})(window);
