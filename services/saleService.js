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
  if (net > 0) return 'profit';
  if (net < 0) return 'loss';
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

async function nextSaleCode() {
  const year = new Date().getFullYear();
  const prefix = `SALE-${year}-`;
  const latest = await Sale.findOne({ saleCode: { $regex: `^${prefix}` } })
    .sort({ saleCode: -1 })
    .select('saleCode')
    .lean();

  let seq = 1;
  if (latest?.saleCode) {
    const part = Number(String(latest.saleCode).split('-').pop());
    if (Number.isFinite(part)) seq = part + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Auto-fetch historical investments for the project/property tied to an investment code.
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
    .select('investmentCode amount status location sector investorName partner createdAt');

  const lines = related.map((item) => ({
    investment: item._id,
    investmentCode: item.investmentCode || String(item._id),
    amount: money(item.amount),
    status: item.status,
    createdAt: item.createdAt,
  }));

  const totalInvestment = money(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0));

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
    },
    projectLabel: projectLabelFor(investment),
    totalInvestment,
    investments: lines,
  };
}

async function createSale({
  investmentCode,
  productName = '',
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  notes = '',
  recordedBy = 'Admin',
}) {
  const saleAmt = money(saleAmount);
  const costs = money(additionalCosts);
  const taxAmt = money(tax);

  if (saleAmt < 0) {
    const error = new Error('Sale amount cannot be negative.');
    error.status = 400;
    throw error;
  }
  if (costs < 0 || taxAmt < 0) {
    const error = new Error('Additional costs and tax cannot be negative.');
    error.status = 400;
    throw error;
  }

  const project = await lookupProjectInvestments(investmentCode);
  const totalInvestment = money(project.totalInvestment);
  const netProfitLoss = computeNetProfitLoss({
    saleAmount: saleAmt,
    totalInvestment,
    additionalCosts: costs,
    tax: taxAmt,
  });
  const outcomeType = outcomeFromNet(netProfitLoss);
  const saleCode = await nextSaleCode();

  const sale = await Sale.create({
    saleCode,
    productName: String(productName || '').trim() || project.projectLabel,
    projectLabel: project.projectLabel,
    primaryInvestment: project.primary.id,
    investmentCode: project.primary.investmentCode,
    investorName: project.primary.investorName,
    location: project.primary.location,
    sector: project.primary.sector,
    saleAmount: saleAmt,
    additionalCosts: costs,
    tax: taxAmt,
    totalInvestment,
    investmentLines: project.investments.map((line) => ({
      investment: line.investment,
      investmentCode: line.investmentCode,
      amount: line.amount,
    })),
    netProfitLoss,
    outcomeType,
    notes: String(notes || '').trim(),
    recordedBy: String(recordedBy || 'Admin').trim(),
  });

  // Reflect sale outcome on the primary investment without redistributing member profits
  const primary = await Investment.findById(project.primary.id);
  if (primary && primary.status === 'active') {
    primary.status = 'sold';
    primary.saleAmount = saleAmt;
    primary.outcomeType = outcomeType === 'break_even' ? 'profit' : outcomeType;
    primary.soldAt = new Date();
    if (!primary.notes) {
      primary.notes = `Sold via ${saleCode}`;
    }
    await primary.save();
  }

  let bankLedger = null;
  let ledgerWarning = null;
  if (saleAmt > 0) {
    try {
      const { creditInbound } = require('./bankLedgerService');
      bankLedger = await creditInbound({
        type: 'project_sale',
        amount: saleAmt,
        referenceType: 'Sale',
        referenceId: sale._id,
        note: `Project sale/liquidation ${saleCode}: ${sale.productName || sale.projectLabel}`,
        createdBy: String(recordedBy || 'Admin').trim(),
      });
    } catch (error) {
      console.error('[createSale] bank ledger credit failed:', error.message);
      ledgerWarning = error.message;
    }
  }

  return {
    sale,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? null,
    ledgerWarning,
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
  lookupProjectInvestments,
  createSale,
  listSales,
  getSaleById,
};
