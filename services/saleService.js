const Sale = require('../models/Sale');
const Investment = require('../models/Investment');
const { getInvestmentByCode } = require('./investmentService');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function computeNetProfitLoss({ saleAmount, totalInvestment, additionalCosts, tax }) {
  return money(
    money(saleAmount) - money(totalInvestment) - money(additionalCosts) - money(tax)
  );
}

function outcomeFromNet(net) {
  if (net > 0.001) return 'profit';
  if (net < -0.001) return 'loss';
  return 'break_even';
}

function buildProjectFilter(investment) {
  const location = String(investment.location || '').trim();
  const sector = String(investment.sector || '').trim();

  // Prefer grouping by property location, then sector, else the single investment
  if (location) {
    return {
      location,
      status: { $nin: ['rejected'] },
    };
  }
  if (sector) {
    return {
      sector,
      status: { $nin: ['rejected'] },
    };
  }
  return {
    _id: investment._id,
    status: { $nin: ['rejected'] },
  };
}

function projectLabelFor(investment) {
  const location = String(investment.location || '').trim();
  const sector = String(investment.sector || '').trim();
  if (location && sector) return `${location} · ${sector}`;
  if (location) return location;
  if (sector) return sector;
  return investment.investmentCode || 'Project';
}

/**
 * Auto-fetch historical investments for the project/property tied to an investment code.
 * Active totals drive Sell Project net math; closed/sold history is included for transparency.
 */
async function lookupProjectInvestments(investmentCode) {
  const investment = await getInvestmentByCode(investmentCode);
  if (!investment) {
    const error = new Error('Investment not found for that ID.');
    error.status = 404;
    throw error;
  }

  const filter = buildProjectFilter(investment);
  const related = await Investment.find(filter)
    .sort({ createdAt: 1 })
    .select('investmentCode amount status location sector investorName partner createdAt societyOwnershipPct investorOwnershipPct');

  const lines = related.map((item) => ({
    investment: item._id,
    investmentCode: item.investmentCode || String(item._id),
    amount: money(item.amount),
    status: item.status,
    createdAt: item.createdAt,
  }));

  const activeLines = lines.filter((line) => line.status === 'active');
  const totalInvestment = money(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const activeTotalInvestment = money(
    activeLines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
  );

  return {
    primary: {
      id: investment._id,
      investmentCode: investment.investmentCode,
      investorName: investment.investorName || investment.partner || '',
      location: investment.location || '',
      sector: investment.sector || '',
      amount: money(investment.amount),
      status: investment.status,
      dateOfBirth: investment.dateOfBirth,
      societyOwnershipPct: investment.societyOwnershipPct,
      investorOwnershipPct: investment.investorOwnershipPct,
    },
    projectLabel: projectLabelFor(investment),
    /** @deprecated prefer activeTotalInvestment for sell math */
    totalInvestment: activeTotalInvestment > 0 ? activeTotalInvestment : totalInvestment,
    activeTotalInvestment,
    historicalTotalInvestment: totalInvestment,
    activeCount: activeLines.length,
    investments: lines,
    canSell: activeLines.length > 0 && investment.status === 'active',
  };
}

/**
 * Legacy sales endpoint — delegates to liquidateProject so member splits,
 * ledger credits/debits, and Sale list stay consistent with Sell Product UI.
 */
async function createSale({
  investmentCode,
  productName = '',
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  notes = '',
  recordedBy = 'Admin',
}) {
  const project = await lookupProjectInvestments(investmentCode);
  if (!project.canSell) {
    const error = new Error('No active investments available to sell for this project.');
    error.status = 400;
    throw error;
  }

  const { liquidateProject } = require('./projectFinanceService');
  const result = await liquidateProject({
    investmentId: project.primary.id,
    saleAmount,
    additionalCosts,
    tax,
    notes,
    recordedBy,
    productName,
  });

  return {
    sale: result.sale,
    investment: result.investment,
    settlement: result.settlement,
    bankLedger: result.bankLedger,
    bookBalance: result.bankLedger?.ledger?.bookBalance ?? null,
    ledgerWarning: null,
    message: result.message,
  };
}

async function listSales(limit = 100) {
  return Sale.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 500));
}

async function getSaleById(id) {
  const sale = await Sale.findById(id);
  if (!sale) {
    const error = new Error('Sale not found.');
    error.status = 404;
    throw error;
  }
  return sale;
}

module.exports = {
  money,
  computeNetProfitLoss,
  outcomeFromNet,
  lookupProjectInvestments,
  createSale,
  listSales,
  getSaleById,
};
