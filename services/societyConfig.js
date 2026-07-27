// Cooperative society model: equal monthly contributions, pooled fund, equal profit shares.
const DISTRIBUTION_MODE = 'equal';
const DIVIDEND_SAVINGS_WEIGHT = Number(process.env.DIVIDEND_SAVINGS_WEIGHT) || 0.6;
const DIVIDEND_PROFIT_WEIGHT = Number(process.env.DIVIDEND_PROFIT_WEIGHT) || 0.4;
const PROFIT_WINDOW_MIN_MONTHS = 10;
const PROFIT_WINDOW_MAX_MONTHS = 12;

function getMonthlyContributionAmount() {
  const configured = Number(process.env.MONTHLY_CONTRIBUTION);
  return configured > 0 ? configured : null;
}

function isEqualShareSociety() {
  return DISTRIBUTION_MODE === 'equal';
}

function getDistributionType() {
  return DISTRIBUTION_MODE;
}

function getDividendWeights() {
  return {
    savingsWeight: DIVIDEND_SAVINGS_WEIGHT,
    profitWeight: DIVIDEND_PROFIT_WEIGHT,
  };
}

function getInvestmentProfitWindow(createdAt) {
  const base = new Date(createdAt);
  const profitFrom = new Date(base);
  const profitUntil = new Date(base);
  profitFrom.setMonth(profitFrom.getMonth() + PROFIT_WINDOW_MIN_MONTHS);
  profitUntil.setMonth(profitUntil.getMonth() + PROFIT_WINDOW_MAX_MONTHS);

  return { profitFrom, profitUntil };
}

function formatInvestmentProfitWindow(createdAt) {
  const { profitFrom, profitUntil } = getInvestmentProfitWindow(createdAt);
  const formatDate = (value) => value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatDate(profitFrom)} to ${formatDate(profitUntil)}`;
}

module.exports = {
  formatInvestmentProfitWindow,
  getDistributionType,
  getDividendWeights,
  getInvestmentProfitWindow,
  getMonthlyContributionAmount,
  isEqualShareSociety,
  PROFIT_WINDOW_MAX_MONTHS,
  PROFIT_WINDOW_MIN_MONTHS,
};
