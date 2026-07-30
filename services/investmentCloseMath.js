'use strict';

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Pure plan for investment close / partial liquidation.
 * PnL = saleAmount − principalClosed (positive = profit, negative = loss).
 */
function computeInvestmentClosePlan({
  originalAmount = 0,
  liquidatedPrincipal = 0,
  saleAmount = 0,
  principalToClose = null,
} = {}) {
  const original = money(originalAmount);
  const alreadyLiquidated = money(liquidatedPrincipal);
  const remaining = money(Math.max(0, original - alreadyLiquidated));
  const sale = money(saleAmount);

  if (!(original > 0)) {
    throw httpError('Investment amount must be greater than zero.');
  }
  if (!(remaining > 0)) {
    throw httpError('This investment has no remaining principal to close.', 409);
  }
  if (sale < 0) {
    throw httpError('Sale / return amount cannot be negative.');
  }

  let closePrincipal;
  if (principalToClose === null || principalToClose === undefined || principalToClose === '') {
    closePrincipal = remaining;
  } else {
    closePrincipal = money(principalToClose);
  }

  if (!(closePrincipal > 0)) {
    throw httpError('Principal to close must be greater than zero.');
  }
  if (closePrincipal > remaining + 0.001) {
    throw httpError(
      `Principal to close exceeds remaining ${remaining.toFixed(2)}.`
    );
  }
  closePrincipal = money(Math.min(closePrincipal, remaining));

  const pnl = money(sale - closePrincipal);
  let outcomeType = 'break_even';
  if (pnl > 0.001) outcomeType = 'profit';
  else if (pnl < -0.001) outcomeType = 'loss';

  const remainingAfter = money(Math.max(0, remaining - closePrincipal));
  const isPartial = remainingAfter > 0.001;
  // Recovered capital returned to member savings: full principal on profit/break-even; sale proceeds on loss.
  const principalRefund = outcomeType === 'loss' ? sale : closePrincipal;
  const profitAmount = outcomeType === 'profit' ? pnl : 0;
  const lossAmount = outcomeType === 'loss' ? money(-pnl) : 0;

  return {
    originalAmount: original,
    alreadyLiquidated,
    remaining,
    closePrincipal,
    saleAmount: sale,
    pnl,
    outcomeType,
    profitAmount,
    lossAmount,
    principalRefund,
    isPartial,
    remainingAfter,
    liquidatedPrincipalAfter: money(alreadyLiquidated + closePrincipal),
  };
}

module.exports = {
  money,
  computeInvestmentClosePlan,
};
