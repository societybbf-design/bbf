const Investment = require('../models/Investment');
const InvestmentProfit = require('../models/InvestmentProfit');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { formatMoney } = require('./moneyFormat');
const { getDistributionType } = require('./societyConfig');
const {
  withMongoTransaction,
  bindSession,
  sessionOpt,
  createWithSession,
} = require('./mongoTransaction');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeOwnership({
  societyOwnershipPct,
  investorOwnershipPct,
  amount,
  societyAmount,
  externalAmount,
  externalInvestors = null,
} = {}) {
  const total = money(amount);
  if (!(total > 0)) {
    throw httpError('Project amount must be greater than zero.');
  }

  const rawInvestors = Array.isArray(externalInvestors) ? externalInvestors : null;

  // Multi-investor path
  if (rawInvestors && rawInvestors.length) {
    let societyPct = societyOwnershipPct != null ? Number(societyOwnershipPct) : null;
    const stakes = [];
    let externalPctSum = 0;
    const seenInvestors = new Set();
    for (const row of rawInvestors) {
      const pct = Number(row.ownershipPct);
      if (!Number.isFinite(pct) || pct <= 0) {
        throw httpError('Each external investor ownership % must be greater than zero.');
      }
      if (pct > 100) {
        throw httpError('External investor ownership % cannot exceed 100.');
      }
      const investorKey = String(row.investorId || row.investor || '').trim();
      if (investorKey) {
        if (seenInvestors.has(investorKey)) {
          throw httpError('Duplicate external investors are not allowed.');
        }
        seenInvestors.add(investorKey);
      }
      externalPctSum = money(externalPctSum + pct);
      stakes.push({
        investor: row.investorId || row.investor || null,
        investorName: String(row.investorName || '').trim(),
        ownershipPct: money(pct),
      });
    }
    if (societyPct == null) {
      societyPct = money(100 - externalPctSum);
    }
    societyPct = Number(societyPct);
    if (!Number.isFinite(societyPct) || societyPct < 0 || societyPct > 100) {
      throw httpError('Society ownership percentage must be between 0 and 100.');
    }
    if (Math.abs(money(societyPct + externalPctSum) - 100) > 0.05) {
      throw httpError(
        'Society ownership (%) plus all external investors’ ownership (%) must equal exactly 100%.'
      );
    }

    const societyAmt = money((total * societyPct) / 100);
    let allocatedExternal = 0;
    const pricedStakes = stakes.map((stake, index) => {
      let stakeAmount;
      if (index === stakes.length - 1) {
        stakeAmount = money(total - societyAmt - allocatedExternal);
      } else {
        stakeAmount = money((total * stake.ownershipPct) / 100);
        allocatedExternal = money(allocatedExternal + stakeAmount);
      }
      return {
        ...stake,
        amount: stakeAmount,
        capitalReceived: 0,
        capitalReceivedAt: null,
        profitBalance: 0,
      };
    });
    const externalAmt = money(pricedStakes.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    if (Math.abs(money(societyAmt + externalAmt) - total) > 0.02) {
      throw httpError('Ownership capital legs must equal total project amount.', 500);
    }
    return {
      amount: total,
      societyOwnershipPct: money(societyPct),
      investorOwnershipPct: money(externalPctSum),
      societyAmount: societyAmt,
      externalAmount: externalAmt,
      externalInvestors: pricedStakes,
    };
  }

  let societyPct = societyOwnershipPct;
  let investorPct = investorOwnershipPct;

  if (societyPct == null && investorPct == null && societyAmount == null && externalAmount == null) {
    societyPct = 100;
    investorPct = 0;
  }

  if (societyAmount != null || externalAmount != null) {
    const sAmt = money(societyAmount != null ? societyAmount : total - money(externalAmount));
    const eAmt = money(externalAmount != null ? externalAmount : total - sAmt);
    if (Math.abs(money(sAmt + eAmt) - total) > 0.02) {
      throw httpError('Society amount + external amount must equal total project amount.');
    }
    societyPct = total > 0 ? money((sAmt / total) * 100) : 100;
    investorPct = money(100 - societyPct);
    return {
      amount: total,
      societyOwnershipPct: societyPct,
      investorOwnershipPct: investorPct,
      societyAmount: sAmt,
      externalAmount: eAmt,
      externalInvestors: [],
    };
  }

  societyPct = Number(societyPct);
  investorPct = Number(investorPct);
  if (!Number.isFinite(societyPct) || !Number.isFinite(investorPct)) {
    throw httpError('Ownership percentages are required.');
  }
  if (Math.abs(money(societyPct + investorPct) - 100) > 0.05) {
    throw httpError('Society ownership (%) plus all external investors’ ownership (%) must equal exactly 100%.');
  }
  if (societyPct < 0 || investorPct < 0 || societyPct > 100 || investorPct > 100) {
    throw httpError('Ownership percentages must be between 0 and 100.');
  }

  const sAmt = money((total * societyPct) / 100);
  const eAmt = money(total - sAmt);
  return {
    amount: total,
    societyOwnershipPct: money(societyPct),
    investorOwnershipPct: money(investorPct),
    societyAmount: sAmt,
    externalAmount: eAmt,
    externalInvestors: [],
  };
}

function splitByOwnership(totalAmount, societyPct, investorPct) {
  const total = money(totalAmount);
  const sPct = Number(societyPct) || 0;
  const societyShare = money((total * sPct) / 100);
  const investorShare = money(total - societyShare);
  return {
    total,
    societyShare,
    investorShare,
    societyOwnershipPct: money(sPct),
    investorOwnershipPct: money(Number(investorPct) || money(100 - sPct)),
    investorShares: investorShare > 0 ? [{
      investor: null,
      investorName: '',
      ownershipPct: money(Number(investorPct) || money(100 - sPct)),
      share: investorShare,
    }] : [],
  };
}

/**
 * Split an amount across society + each external investor by ownership %.
 * Residual cents go to the last investor (or society when no investors).
 */
function splitByStakeholders(totalAmount, {
  societyOwnershipPct = 100,
  investorOwnershipPct = 0,
  externalInvestors = [],
} = {}) {
  const total = money(totalAmount);
  const stakes = Array.isArray(externalInvestors)
    ? externalInvestors.filter((row) => Number(row.ownershipPct) > 0)
    : [];

  if (!stakes.length) {
    return splitByOwnership(total, societyOwnershipPct, investorOwnershipPct);
  }

  const societyPct = Number(societyOwnershipPct) || 0;
  const societyShare = money((total * societyPct) / 100);
  let allocated = societyShare;
  const investorShares = stakes.map((stake, index) => {
    let share;
    if (index === stakes.length - 1) {
      share = money(total - allocated);
    } else {
      share = money((total * Number(stake.ownershipPct || 0)) / 100);
      allocated = money(allocated + share);
    }
    return {
      investor: stake.investor?._id || stake.investor || null,
      investorName: stake.investorName || stake.investor?.name || '',
      ownershipPct: money(stake.ownershipPct),
      share,
      stakeId: stake._id || null,
    };
  });
  const investorShare = money(investorShares.reduce((sum, row) => sum + Number(row.share || 0), 0));
  return {
    total,
    societyShare,
    investorShare,
    societyOwnershipPct: money(societyPct),
    investorOwnershipPct: money(
      stakes.reduce((sum, row) => sum + Number(row.ownershipPct || 0), 0)
    ),
    investorShares,
  };
}

function resolveProjectStakeholders(investment) {
  const externalInvestors = Array.isArray(investment?.externalInvestors)
    ? investment.externalInvestors
    : [];
  if (externalInvestors.length) {
    return {
      societyOwnershipPct: Number(investment.societyOwnershipPct ?? 100),
      investorOwnershipPct: Number(investment.investorOwnershipPct ?? 0),
      externalInvestors,
    };
  }
  return {
    societyOwnershipPct: Number(investment?.societyOwnershipPct ?? 100),
    investorOwnershipPct: Number(investment?.investorOwnershipPct ?? 0),
    externalInvestors: Number(investment?.investorOwnershipPct) > 0
      ? [{
        investor: investment.investor?._id || investment.investor || null,
        investorName: investment.investorName || investment.investor?.name || '',
        ownershipPct: Number(investment.investorOwnershipPct || 0),
        amount: Number(investment.externalAmount || 0),
        profitBalance: Number(investment.investorProfitBalance || 0),
      }]
      : [],
  };
}

function assertNotLocked(investment) {
  if (investment.ledgerLockedAt || ['sold', 'closed'].includes(investment.status)) {
    throw httpError('This project ledger is locked after sale/settlement and cannot be modified.', 409);
  }
}

async function getActiveProject(investmentIdOrCode, session = null) {
  const query = String(investmentIdOrCode || '').match(/^[a-f\d]{24}$/i)
    ? { _id: investmentIdOrCode }
    : { investmentCode: String(investmentIdOrCode || '').trim().toUpperCase() };

  const investment = await bindSession(
    Investment.findOne(query)
      .populate('investor', 'name email role phone')
      .populate('externalInvestors.investor', 'name email role phone')
      .populate('projectManager', 'name email role'),
    session
  );
  if (!investment) {
    throw httpError('Project / investment not found.', 404);
  }
  return investment;
}

/** Active sibling investments for the same property/sector (Sell Project group capital). */
async function listRelatedActiveInvestments(primary, session = null) {
  const location = String(primary.location || '').trim();
  const sector = String(primary.sector || '').trim();
  let filter;
  if (location) {
    filter = { location, status: 'active', ledgerLockedAt: null };
  } else if (sector) {
    filter = { sector, status: 'active', ledgerLockedAt: null };
  } else {
    filter = { _id: primary._id, status: 'active', ledgerLockedAt: null };
  }
  const rows = await bindSession(
    Investment.find(filter).sort({ createdAt: 1 }),
    session
  );
  if (!rows.some((row) => String(row._id) === String(primary._id))) {
    return [primary, ...rows];
  }
  return rows;
}

async function nextSaleCode(session = null) {
  const year = new Date().getFullYear();
  const prefix = `SALE-${year}-`;
  const latest = await bindSession(
    Sale.findOne({ saleCode: { $regex: `^${prefix}` } }).sort({ saleCode: -1 }).select('saleCode'),
    session
  );
  let seq = 1;
  if (latest?.saleCode) {
    const part = Number(String(latest.saleCode).split('-').pop());
    if (Number.isFinite(part)) seq = part + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * CEO records a physical cash deposit for a specific External Investor
 * against one of their project ownership stakes (isolated external ledger).
 * Supports partial / incremental deposits up to the remaining committed capital.
 */
async function recordCeoExternalInvestorDeposit({
  investorId,
  investmentId,
  amount,
  note = '',
  recordedBy = 'CEO',
} = {}) {
  if (!investorId) throw httpError('External investor is required.');
  if (!investmentId) throw httpError('Project is required.');

  const investment = await getActiveProject(investmentId);
  assertNotLocked(investment);
  if (!['active', 'pending_cashier_payment', 'pending_member_approval'].includes(investment.status)) {
    throw httpError('External deposits can only be recorded for open projects.');
  }

  const stake = (investment.externalInvestors || []).find(
    (row) => String(row.investor?._id || row.investor || '') === String(investorId)
  );
  if (!stake) {
    throw httpError('This External Investor does not hold an ownership stake on the selected project.', 404);
  }

  const deposit = money(amount);
  if (!(deposit > 0)) throw httpError('Deposit amount must be greater than zero.');

  const committed = money(stake.amount || 0);
  const already = money(stake.capitalReceived || 0);
  const remaining = money(Math.max(0, committed - already));
  if (!(remaining > 0.001)) {
    throw httpError('This investor’s committed capital for the project is already fully deposited.', 409);
  }
  if (deposit - remaining > 0.02) {
    throw httpError(
      `Deposit cannot exceed remaining committed capital ${formatMoney(remaining, 2)} `
      + `(committed ${formatMoney(committed, 2)}, already received ${formatMoney(already, 2)}).`
    );
  }

  const User = require('../models/User');
  const investor = await User.findOne({
    _id: investorId,
    role: 'external_investor',
    status: { $ne: 'deleted' },
  }).select('name email');
  if (!investor) throw httpError('External investor not found.', 404);

  const { creditExternalCapital } = require('./externalInvestorLedgerService');
  const externalLedger = await creditExternalCapital(investment, deposit, {
    investor: investor._id,
    investorName: investor.name || stake.investorName || '',
    note: note?.trim()
      || `CEO cash deposit from ${investor.name || 'External Investor'} for ${investment.investmentCode}`,
    createdBy: recordedBy,
    referenceType: 'ExternalInvestorDeposit',
    referenceId: investment._id,
  });

  const now = new Date();
  stake.capitalReceived = money(already + deposit);
  stake.capitalReceivedAt = now;
  stake.investorName = stake.investorName || investor.name || '';

  investment.externalCapitalReceived = money(
    Number(investment.externalCapitalReceived || 0) + deposit
  );
  investment.externalCapitalReceivedAt = now;
  investment.externalCapitalRecordedBy = String(recordedBy || 'CEO').trim();
  investment.externalCapitalLedgerEntryId = externalLedger?.entry?._id || investment.externalCapitalLedgerEntryId || null;
  await investment.save();

  return {
    investment,
    investor,
    stake: {
      investor: stake.investor,
      investorName: stake.investorName,
      ownershipPct: stake.ownershipPct,
      amount: money(stake.amount),
      capitalReceived: money(stake.capitalReceived),
      remaining: money(Math.max(0, committed - stake.capitalReceived)),
    },
    externalLedger,
    deposit,
    message: `Recorded cash deposit ${formatMoney(deposit, 2)} for ${investor.name || 'External Investor'} `
      + `on ${investment.investmentCode}. Capital received ${formatMoney(stake.capitalReceived, 2)} / ${formatMoney(committed, 2)}.`,
  };
}

/**
 * Cashier records inbound external investor capital for a co-funded project.
 */
async function recordExternalInvestment({
  investmentId,
  amount = null,
  note = '',
  paymentChannel = '',
  paymentReference = '',
  recordedBy = 'Cashier',
} = {}) {
  const investment = await getActiveProject(investmentId);
  assertNotLocked(investment);

  if (!['active', 'pending_cashier_payment', 'pending_member_approval'].includes(investment.status)) {
    throw httpError('External capital can only be recorded for open projects.');
  }

  const expected = money(investment.externalAmount || 0);
  if (expected <= 0) {
    throw httpError('This project has 0% external ownership — no external capital to record.');
  }

  const already = money(investment.externalCapitalReceived || 0);
  const remaining = money(Math.max(0, expected - already));
  if (!(remaining > 0.001)) {
    throw httpError('External capital has already been fully recorded for this project.', 409);
  }

  // Partial / incremental deposits allowed (CEO may have recorded some stake cash already).
  const received = money(amount != null ? amount : remaining);
  if (!(received > 0)) {
    throw httpError('External investment amount must be greater than zero.');
  }
  if (received - remaining > 0.02) {
    throw httpError(
      `External capital cannot exceed remaining ${formatMoney(remaining, 2)} `
      + `(expected ${formatMoney(expected, 2)}, already received ${formatMoney(already, 2)}).`
    );
  }

  // Absolute isolation: external capital never credits the Society Bank Ledger.
  const { creditExternalCapital } = require('./externalInvestorLedgerService');
  const externalLedger = await creditExternalCapital(investment, received, {
    note: note?.trim()
      || `External investor capital for ${investment.investmentCode} (${investment.investorName || 'investor'})`,
    createdBy: recordedBy,
    referenceType: 'Investment',
    referenceId: investment._id,
    investorName: investment.investorName || '',
    paymentChannel: paymentChannel || undefined,
    paymentReference: paymentReference || undefined,
  });

  const now = new Date();
  investment.externalCapitalReceived = money(already + received);
  investment.externalCapitalReceivedAt = now;
  investment.externalCapitalRecordedBy = String(recordedBy || 'Cashier').trim();
  // Legacy field retained for audit pointers — now references external sub-ledger entry.
  investment.externalCapitalLedgerEntryId = externalLedger?.entry?._id || null;

  // Allocate this deposit across stakes that still have remaining committed capital.
  if (Array.isArray(investment.externalInvestors) && investment.externalInvestors.length) {
    let left = received;
    for (const stake of investment.externalInvestors) {
      if (!(left > 0.001)) break;
      const stakeRemaining = money(Math.max(0, Number(stake.amount || 0) - Number(stake.capitalReceived || 0)));
      if (!(stakeRemaining > 0.001)) continue;
      const apply = money(Math.min(left, stakeRemaining));
      stake.capitalReceived = money(Number(stake.capitalReceived || 0) + apply);
      stake.capitalReceivedAt = now;
      left = money(left - apply);
    }
  }

  await investment.save();

  return {
    investment,
    externalLedger,
    bankLedger: null,
    societyBankImpact: false,
    message: `External investment of ${formatMoney(received, 2)} recorded on project external sub-ledger for ${investment.investmentCode} `
      + `(${formatMoney(investment.externalCapitalReceived, 2)} / ${formatMoney(expected, 2)}). Society bank ledger was not affected.`,
  };
}

async function distributeSocietyShareToMembers(societyShare, recordedBy, options = {}) {
  if (!(societyShare > 0)) {
    return { memberCount: 0, shares: [], updatedMembers: [], distributionType: 'equal' };
  }
  const { distributeAmountToMembers } = require('./profitService');
  const { getDistributionType } = require('./societyConfig');
  const now = new Date();
  const yearMonth = options.yearMonth
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Equal-share society: every eligible active member gets the same profit.
  // Late payment / internal borrow / emergency cover do not change eligibility or share size.
  return distributeAmountToMembers({
    totalAmount: societyShare,
    distributionType: getDistributionType(),
    forceDistributionType: false,
    distributedBy: recordedBy,
    yearMonth,
    asOfDate: options.asOfDate || now,
    session: options.session || null,
  });
}

/**
 * Monthly return projects: record recurring profit and split by ownership.
 * New members activated mid-month become eligible starting next calendar month.
 */
async function recordMonthlyProjectReturn({
  investmentId,
  profitAmount,
  externalExtraExpenses = 0,
  notes = '',
  recordedBy = 'Cashier',
  yearMonth = null,
} = {}) {
  const result = await withMongoTransaction(async (session) => {
    const investment = await getActiveProject(investmentId, session);
    assertNotLocked(investment);

    if (investment.status !== 'active') {
      throw httpError('Monthly returns can only be recorded for active projects.');
    }
    if (investment.returnMode !== 'monthly') {
      throw httpError('This project is fixed/term — use sale/liquidation instead of monthly returns.');
    }

    const profit = money(profitAmount);
    if (!(profit > 0)) {
      throw httpError('Monthly profit amount must be greater than zero.');
    }
    const externalExtra = money(Math.max(0, externalExtraExpenses));

    const stakeholders = resolveProjectStakeholders(investment);
    const split = splitByStakeholders(profit, stakeholders);
    // External-specific expenses reduce only the external profit share.
    const externalExpenseApplied = money(Math.min(externalExtra, split.investorShare));
    const externalNetProfit = money(Math.max(0, split.investorShare - externalExpenseApplied));
    split.externalExtraExpenses = externalExpenseApplied;
    split.externalNetProfit = externalNetProfit;

    const now = new Date();
    const periodYearMonth = yearMonth
      || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const distribution = await distributeSocietyShareToMembers(split.societyShare, recordedBy, {
      yearMonth: periodYearMonth,
      asOfDate: now,
      session,
    });

    investment.profit = money(Number(investment.profit || 0) + profit);
    investment.monthlyProfitTotal = money(Number(investment.monthlyProfitTotal || 0) + profit);
    investment.investorProfitBalance = money(
      Number(investment.investorProfitBalance || 0) + externalNetProfit
    );

    const netShareByKey = new Map();
    if (Array.isArray(investment.externalInvestors) && investment.externalInvestors.length) {
      const shareByKey = new Map(
        (split.investorShares || []).map((row) => [
          String(row.stakeId || row.investor || row.investorName || ''),
          money(row.share),
        ])
      );
      const grossExternal = money(Math.max(split.investorShare, 0.001));
      for (const stake of investment.externalInvestors) {
        const key = String(stake._id || stake.investor || stake.investorName || '');
        const stakeGross = shareByKey.has(key)
          ? shareByKey.get(key)
          : money((profit * Number(stake.ownershipPct || 0)) / 100);
        const stakeExpense = money((stakeGross / grossExternal) * externalExpenseApplied);
        const stakeNet = money(Math.max(0, stakeGross - stakeExpense));
        netShareByKey.set(key, stakeNet);
        stake.profitBalance = money(Number(stake.profitBalance || 0) + stakeNet);
      }
      // Keep aggregate in sync with per-stake balances (cash conservation).
      investment.investorProfitBalance = money(
        investment.externalInvestors.reduce((sum, row) => sum + Number(row.profitBalance || 0), 0)
      );
    }

    await investment.save(sessionOpt(session));

    const record = await createWithSession(InvestmentProfit, {
      investment: investment._id,
      investmentCode: investment.investmentCode,
      sector: investment.sector,
      partner: investment.partner,
      investmentAmount: Number(investment.amount || 0),
      saleAmount: 0,
      profitAmount: profit,
      outcomeType: 'profit',
      distributionType: distribution.distributionType || getDistributionType(),
      memberCount: distribution.memberCount,
      shares: distribution.shares,
      societyProfitShare: split.societyShare,
      investorProfitShare: externalNetProfit,
      societyOwnershipPct: split.societyOwnershipPct,
      investorOwnershipPct: split.investorOwnershipPct,
      distributionKind: 'monthly_return',
      breakdown: {
        kind: 'monthly_return',
        yearMonth: periodYearMonth,
        societyShare: split.societyShare,
        investorShares: split.investorShares || [],
        externalExtraExpenses: externalExpenseApplied,
        externalNetProfit,
      },
      notes: notes?.trim() || `Monthly project return (${periodYearMonth}) — equal share among eligible members; new members from next month after join`,
      recordedBy: String(recordedBy || 'Cashier').trim(),
    }, session);

    // Society share only → society bank. External share → isolated sub-ledger.
    let bankLedger = null;
    if (split.societyShare > 0.001) {
      const { creditInbound } = require('./bankLedgerService');
      bankLedger = await creditInbound({
        type: 'monthly_profit',
        amount: split.societyShare,
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        note: `Monthly return society share ${investment.investmentCode} (${periodYearMonth})`,
        createdBy: recordedBy,
        session,
      });
    }

    let externalLedger = null;
    const {
      creditExternalProfitAccrual,
      debitExternalExpenseShare,
    } = require('./externalInvestorLedgerService');
    // Accrue full external ownership share, then deduct external-specific expenses.
    if (split.investorShare > 0.001) {
      externalLedger = await creditExternalProfitAccrual(investment, split.investorShare, {
        note: `Monthly return external share ${investment.investmentCode} (${periodYearMonth})`,
        createdBy: recordedBy,
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        session,
      });
    }
    if (externalExpenseApplied > 0.001) {
      await debitExternalExpenseShare(investment, externalExpenseApplied, {
        note: `External-specific expense on monthly return ${investment.investmentCode} (${periodYearMonth})`,
        createdBy: recordedBy,
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        session,
      });
    }

    // Queue external investor approval before profit is marked paid / executable.
    let payoutRequests = [];
    if (externalNetProfit > 0.001 && Array.isArray(investment.externalInvestors)) {
      const { queueExternalSettlementPayouts } = require('./externalInvestorPortalService');
      const queued = await queueExternalSettlementPayouts({
        investment,
        investorPayouts: (investment.externalInvestors || []).map((stake) => {
          const key = String(stake._id || stake.investor || stake.investorName || '');
          return {
            investor: stake.investor?._id || stake.investor || null,
            investorName: stake.investorName || stake.investor?.name || '',
            capitalShare: 0,
            profitShare: netShareByKey.get(key) || 0,
            lossShare: 0,
            accruedProfit: 0,
          };
        }),
        externalExtraExpenses: 0, // already deducted above
        source: 'monthly_return',
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        note: `Monthly return payout ${investment.investmentCode} (${periodYearMonth})`,
        createdBy: recordedBy,
        session,
      });
      payoutRequests = queued.requests || [];
    }

    const investorLabel = formatMoney(externalNetProfit, 2);

    return {
      investment,
      record,
      split,
      distribution,
      yearMonth: periodYearMonth,
      bankLedger,
      externalLedger,
      payoutRequests,
      externalExtraExpenses: externalExpenseApplied,
      message: `Monthly return ${formatMoney(profit, 2)} for ${periodYearMonth} — society ${formatMoney(split.societyShare, 2)} to members (society bank)`
        + (externalExpenseApplied > 0 ? `, external expense ${formatMoney(externalExpenseApplied, 2)}` : '')
        + `, external net ${investorLabel} queued for External Investor approval.`,
    };
  });

  return result;
}

/**
 * Pure cent-safe settlement math for Sell Project / liquidation.
 * Cash identity: societySavingsRefund + investorSaleSettlement + societyProfitShare = netProceeds
 * (society profit is booked to member profit balances; loss reduces society savings refund and member profit).
 */
function computeProjectLiquidationSettlement({
  capital,
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  societyOwnershipPct = 100,
  investorOwnershipPct = 0,
  externalInvestors = null,
  accruedInvestorProfit = 0,
  accruedInvestorProfits = null,
} = {}) {
  const groupCapital = money(capital);
  if (!(groupCapital > 0)) {
    throw httpError('Active project capital must be greater than zero.');
  }
  const grossSale = money(saleAmount);
  if (!(grossSale >= 0)) {
    throw httpError('Sale proceeds must be a non-negative amount.');
  }
  const costs = money(additionalCosts);
  const taxAmt = money(tax);
  if (costs < 0 || taxAmt < 0) {
    throw httpError('Additional costs and tax cannot be negative.');
  }

  const netProceeds = money(grossSale - costs - taxAmt);
  const netProfit = money(netProceeds - groupCapital);
  const outcomeType = netProfit > 0.001 ? 'profit' : (netProfit < -0.001 ? 'loss' : 'break_even');

  const stakeholders = {
    societyOwnershipPct,
    investorOwnershipPct,
    externalInvestors: Array.isArray(externalInvestors) ? externalInvestors : [],
  };
  const capitalSplit = splitByStakeholders(groupCapital, stakeholders);
  const profitSplit = splitByStakeholders(Math.max(netProfit, 0), stakeholders);
  const lossAmount = outcomeType === 'loss' ? money(Math.abs(netProfit)) : 0;
  const lossSplit = splitByStakeholders(lossAmount, stakeholders);

  // On loss, return only ownership share of net proceeds to savings (not full capital).
  // On profit/break-even, return full society capital; profit share is distributed separately.
  const societySavingsRefund = outcomeType === 'loss'
    ? money(Math.max(0, capitalSplit.societyShare - lossSplit.societyShare))
    : capitalSplit.societyShare;

  const investorShareRows = capitalSplit.investorShares || [];
  const profitByKey = new Map(
    (profitSplit.investorShares || []).map((row, idx) => [
      String(row.stakeId || row.investor || row.investorName || idx),
      money(row.share),
    ])
  );
  const lossByKey = new Map(
    (lossSplit.investorShares || []).map((row, idx) => [
      String(row.stakeId || row.investor || row.investorName || idx),
      money(row.share),
    ])
  );
  const accruedByKey = accruedInvestorProfits instanceof Map
    ? accruedInvestorProfits
    : new Map(
      Array.isArray(accruedInvestorProfits)
        ? accruedInvestorProfits.map((row) => [
          String(row.stakeId || row.investor || row.investorName || ''),
          money(row.amount || row.profitBalance || 0),
        ])
        : []
    );

  const investorPayouts = investorShareRows.map((row, idx) => {
    const key = String(row.stakeId || row.investor || row.investorName || idx);
    const capitalShare = money(row.share);
    const profitShare = profitByKey.get(key) || 0;
    const lossShare = lossByKey.get(key) || 0;
    const saleSettlement = money(Math.max(0, capitalShare + profitShare - lossShare));
    const accrued = money(Math.max(0, accruedByKey.get(key) || 0));
    return {
      investor: row.investor || null,
      investorName: row.investorName || '',
      ownershipPct: money(row.ownershipPct),
      stakeId: row.stakeId || null,
      capitalShare,
      profitShare,
      lossShare,
      saleSettlement,
      accruedProfit: accrued,
      payout: money(saleSettlement + accrued),
    };
  });

  // Legacy single-investor accrued profit when no per-stake map was provided.
  let accrued = money(Math.max(0, accruedInvestorProfit));
  if (!investorPayouts.length) {
    // no-op
  } else if (!accruedByKey.size && accrued > 0 && investorPayouts.length === 1) {
    investorPayouts[0].accruedProfit = accrued;
    investorPayouts[0].payout = money(investorPayouts[0].saleSettlement + accrued);
  } else if (accruedByKey.size) {
    accrued = money(investorPayouts.reduce((sum, row) => sum + Number(row.accruedProfit || 0), 0));
  } else if (investorPayouts.length > 1 && accrued > 0) {
    // Split aggregate accrued by ownership when per-stake balances are unavailable.
    const accruedSplit = splitByStakeholders(accrued, stakeholders);
    (accruedSplit.investorShares || []).forEach((row, idx) => {
      const key = String(row.stakeId || row.investor || row.investorName || idx);
      const target = investorPayouts.find(
        (p) => String(p.stakeId || p.investor || p.investorName || '') === key
      ) || investorPayouts[idx];
      if (target) {
        target.accruedProfit = money(row.share);
        target.payout = money(target.saleSettlement + target.accruedProfit);
      }
    });
    accrued = money(investorPayouts.reduce((sum, row) => sum + Number(row.accruedProfit || 0), 0));
  }

  const investorSaleSettlement = money(
    investorPayouts.reduce((sum, row) => sum + Number(row.saleSettlement || 0), 0)
  );
  // When no stake rows exist (society-only), still pay any leftover accrued investor profit.
  const investorPayoutFromStakes = money(
    investorPayouts.reduce((sum, row) => sum + Number(row.payout || 0), 0)
  );
  const investorPayout = investorPayouts.length
    ? investorPayoutFromStakes
    : money(investorSaleSettlement + accrued);

  // Sale-cash identity (excludes previously accrued investor profit already in the bank).
  const allocatedFromSale = money(
    societySavingsRefund + investorSaleSettlement + profitSplit.societyShare
  );
  if (Math.abs(allocatedFromSale - Math.max(netProceeds, 0)) > 0.02 && netProceeds >= 0) {
    throw httpError('Settlement math failed cash conservation check. Refresh and retry.', 500);
  }

  return {
    capital: groupCapital,
    grossSale,
    additionalCosts: costs,
    tax: taxAmt,
    netProceeds,
    netProfit,
    outcomeType,
    capitalSplit,
    profitSplit,
    lossSplit,
    societySavingsRefund,
    societyProfitShare: profitSplit.societyShare,
    societyLossShare: lossSplit.societyShare,
    investorSaleSettlement,
    accruedInvestorProfit: accrued,
    investorPayout,
    investorPayouts,
  };
}

/**
 * Sale / liquidation: settle group capital with cent-safe math, update ledger/P&L,
 * create Sale row for Sell List, lock all related active investments atomically.
 */
async function liquidateProject({
  investmentId,
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  externalExtraExpenses = 0,
  notes = '',
  recordedBy = 'Admin',
  productName = '',
} = {}) {
  const result = await withMongoTransaction(async (session) => {
    const seed = await getActiveProject(investmentId, session);
    assertNotLocked(seed);
    if (seed.status !== 'active') {
      throw httpError('Only active projects can be sold / liquidated.');
    }

    const related = await listRelatedActiveInvestments(seed, session);
    const relatedIds = related.map((row) => row._id);
    const lockAt = new Date();
    // Atomic ledger lock on every related active row — blocks concurrent double-sell.
    const claimedCount = await Investment.updateMany(
      {
        _id: { $in: relatedIds },
        status: 'active',
        $or: [{ ledgerLockedAt: null }, { ledgerLockedAt: { $exists: false } }],
      },
      {
        $set: {
          ledgerLockedAt: lockAt,
          ledgerLockedBy: String(recordedBy || 'Admin').trim(),
          updatedAt: lockAt,
        },
      },
      sessionOpt(session)
    );
    const matched = claimedCount.matchedCount ?? claimedCount.n ?? 0;
    if (matched < relatedIds.length) {
      throw httpError('Project was already sold or locked. Refresh and try again.', 409);
    }

    const investment = await bindSession(
      Investment.findById(seed._id)
        .populate('investor', 'name email role phone')
        .populate('projectManager', 'name email role'),
      session
    );
    if (!investment) {
      throw httpError('Project / investment not found.', 404);
    }

    const capital = money(related.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const stakeholders = resolveProjectStakeholders(investment);
    const accruedByKey = new Map();
    let accruedInvestorProfit = 0;
    for (const row of related) {
      accruedInvestorProfit = money(accruedInvestorProfit + Number(row.investorProfitBalance || 0));
      if (Array.isArray(row.externalInvestors) && row.externalInvestors.length) {
        for (const stake of row.externalInvestors) {
          const key = String(stake._id || stake.investor || stake.investorName || '');
          if (!key) continue;
          accruedByKey.set(
            key,
            money((accruedByKey.get(key) || 0) + Number(stake.profitBalance || 0))
          );
        }
      } else if (Number(row.investorOwnershipPct) > 0) {
        const key = String(row.investor?._id || row.investor || row.investorName || 'legacy');
        accruedByKey.set(
          key,
          money((accruedByKey.get(key) || 0) + Number(row.investorProfitBalance || 0))
        );
      }
    }
    const settlementPlan = computeProjectLiquidationSettlement({
      capital,
      saleAmount,
      additionalCosts,
      tax,
      societyOwnershipPct: stakeholders.societyOwnershipPct,
      investorOwnershipPct: stakeholders.investorOwnershipPct,
      externalInvestors: stakeholders.externalInvestors,
      accruedInvestorProfit,
      accruedInvestorProfits: accruedByKey,
    });
    const {
      grossSale,
      additionalCosts: costs,
      tax: taxAmt,
      netProceeds,
      netProfit,
      outcomeType,
      capitalSplit,
      profitSplit,
      lossSplit,
      societySavingsRefund,
      investorPayout,
      investorPayouts,
    } = settlementPlan;

    // Society portion only hits the Society Bank Ledger.
    // External investor capital/profit settlements use the isolated sub-ledger.
    const societyBankCredit = money(
      Number(societySavingsRefund || 0) + Number(profitSplit.societyShare || 0)
    );
    let bankLedger = null;
    if (societyBankCredit > 0.001) {
      const { creditInbound } = require('./bankLedgerService');
      bankLedger = await creditInbound({
        type: 'project_sale',
        amount: societyBankCredit,
        referenceType: 'Investment',
        referenceId: investment._id,
        note: `Project sale society share ${investment.investmentCode} (external settled off society ledger)`,
        createdBy: recordedBy,
        session,
      });
    }

    const { refundToTotalSavings } = require('./investmentService');
    let savingsUpdate = null;
    if (societySavingsRefund > 0.001) {
      savingsUpdate = await refundToTotalSavings(societySavingsRefund, { session });
    }

    let distribution = { memberCount: 0, shares: [], updatedMembers: [], distributionType: getDistributionType() };
    if (profitSplit.societyShare > 0.001) {
      distribution = await distributeSocietyShareToMembers(profitSplit.societyShare, recordedBy, { session });
    } else if (lossSplit.societyShare > 0.001) {
      const { applyLossToMembers } = require('./profitService');
      distribution = await applyLossToMembers({
        totalLoss: lossSplit.societyShare,
        distributedBy: recordedBy,
        session,
      });
    }

    const {
      creditExternalProfitAccrual,
      debitExternalExpenseShare,
      ensureExternalLedger,
    } = require('./externalInvestorLedgerService');
    const { queueExternalSettlementPayouts } = require('./externalInvestorPortalService');
    const investorLedgers = [];
    const externalExtraRequested = money(Math.max(0, externalExtraExpenses));
    const payoutRows = Array.isArray(investorPayouts) && investorPayouts.length
      ? investorPayouts.filter((row) => Number(row.payout) > 0.001 || Number(row.capitalShare) > 0)
      : (investorPayout > 0.001
        ? [{
          investor: investment.investor?._id || investment.investor || null,
          investorName: investment.investorName || 'investor',
          capitalShare: money(capitalSplit?.investorShare || 0),
          profitShare: money(profitSplit?.investorShare || 0),
          lossShare: money(lossSplit?.investorShare || 0),
          accruedProfit: 0,
          payout: investorPayout,
        }]
        : []);

    // External-specific expenses reduce external profit only (never society share).
    const externalProfitPool = money(payoutRows.reduce((sum, row) => (
      sum + Math.max(
        0,
        Number(row.profitShare || 0) - Number(row.lossShare || 0) + Number(row.accruedProfit || 0)
      )
    ), 0));
    const externalExtra = money(Math.min(externalExtraRequested, externalProfitPool));

    // Ensure sub-ledger can cover queued settlement (after expense) + expense debit.
    const neededExternal = money(
      payoutRows.reduce((sum, row) => sum + Number(row.payout || 0), 0)
    );
    if (neededExternal > 0.001 || externalExtra > 0.001) {
      const extLedger = await ensureExternalLedger(investment, session);
      const target = money(neededExternal);
      if (money(extLedger.bookBalance) + 0.001 < target) {
        const gap = money(target - money(extLedger.bookBalance));
        await creditExternalProfitAccrual(investment, gap, {
          note: `External settlement top-up ${investment.investmentCode}`,
          createdBy: recordedBy,
          referenceType: 'Investment',
          referenceId: investment._id,
          session,
        });
      }
    }
    if (externalExtra > 0.001) {
      const expenseOut = await debitExternalExpenseShare(investment, externalExtra, {
        note: `External-specific extra expenses on liquidation ${investment.investmentCode}`,
        createdBy: recordedBy,
        referenceType: 'Investment',
        referenceId: investment._id,
        session,
      });
      investorLedgers.push({ channel: 'external_expense', ledger: expenseOut, amount: externalExtra });
    }

    // External capital/profit wait for External Investor approval before ledger payout.
    const queued = await queueExternalSettlementPayouts({
      investment,
      investorPayouts: payoutRows,
      externalExtraExpenses: externalExtra,
      source: 'liquidation',
      referenceType: 'Investment',
      referenceId: investment._id,
      note: `Liquidation settlement ${investment.investmentCode}`,
      createdBy: recordedBy,
      session,
    });
    for (const req of queued.requests || []) {
      investorLedgers.push({
        investor: req.investor,
        investorName: req.investorName,
        payout: req.amount,
        channel: 'pending_external_approval',
        requestId: req._id,
      });
    }
    const investorLedger = investorLedgers.find((row) => row.channel === 'pending_external_approval') || investorLedgers[0] || null;
    const pendingExternalPayoutTotal = money(
      (queued.requests || []).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    );

    const saleCode = await nextSaleCode(session);
    const projectLabel = [
      String(investment.location || '').trim(),
      String(investment.sector || '').trim(),
    ].filter(Boolean).join(' · ') || investment.investmentCode || 'Project';

    const investorNamesLabel = (stakeholders.externalInvestors || [])
      .map((s) => s.investorName)
      .filter(Boolean)
      .join(', ')
      || investment.investorName
      || investment.partner
      || '';

    const sale = await createWithSession(Sale, {
      saleCode,
      productName: String(productName || '').trim() || projectLabel,
      projectLabel,
      primaryInvestment: investment._id,
      investmentCode: investment.investmentCode,
      investorName: investorNamesLabel,
      location: investment.location || '',
      sector: investment.sector || '',
      saleAmount: grossSale,
      additionalCosts: costs,
      tax: taxAmt,
      totalInvestment: capital,
      investmentLines: related.map((row) => ({
        investment: row._id,
        investmentCode: row.investmentCode || String(row._id),
        amount: money(row.amount),
      })),
      netProfitLoss: netProfit,
      outcomeType,
      notes: notes?.trim() || `Liquidation via ${investment.investmentCode}`,
      recordedBy: String(recordedBy || 'Admin').trim(),
    }, session);

    const record = await createWithSession(InvestmentProfit, {
      investment: investment._id,
      investmentCode: investment.investmentCode,
      sector: investment.sector,
      partner: investment.partner,
      investmentAmount: capital,
      saleAmount: grossSale,
      profitAmount: money(Math.abs(netProfit)),
      outcomeType,
      distributionType: distribution.distributionType || getDistributionType(),
      memberCount: distribution.memberCount,
      shares: distribution.shares,
      societyProfitShare: profitSplit.societyShare,
      investorProfitShare: profitSplit.investorShare,
      societyOwnershipPct: capitalSplit.societyOwnershipPct,
      investorOwnershipPct: capitalSplit.investorOwnershipPct,
      distributionKind: outcomeType === 'loss' ? 'loss' : 'sale',
      breakdown: {
        kind: 'liquidation',
        saleCode,
        societySavingsRefund,
        societyProfitShare: profitSplit.societyShare,
        societyLossShare: lossSplit.societyShare,
        externalExtraExpenses: externalExtra,
        pendingExternalPayoutTotal,
        investorPayouts: (investorPayouts || []).map((row) => ({
          investor: row.investor,
          investorName: row.investorName,
          ownershipPct: row.ownershipPct,
          capitalShare: row.capitalShare,
          profitShare: row.profitShare,
          lossShare: row.lossShare,
          saleSettlement: row.saleSettlement,
          accruedProfit: row.accruedProfit,
          payout: row.payout,
        })),
      },
      notes: notes?.trim()
        || `Liquidation net ${formatMoney(netProceeds, 2)} (sale ${formatMoney(grossSale, 2)} − costs ${formatMoney(costs, 2)} − tax ${formatMoney(taxAmt, 2)}) · capital ${formatMoney(capital, 2)} across ${related.length} investment(s)`,
      recordedBy: String(recordedBy || 'Admin').trim(),
    }, session);

    const ownershipLabel = stakeholders.externalInvestors?.length
      ? `Society ${stakeholders.societyOwnershipPct}% / ${stakeholders.externalInvestors.map((s) => `${s.investorName || 'Investor'} ${s.ownershipPct}%`).join(' · ')}`
      : `Society ${investment.societyOwnershipPct}% / Investor ${investment.investorOwnershipPct}%`;
    const lockNote = `Closed/sold via ${saleCode}. ${ownershipLabel}. Group capital ${formatMoney(capital, 2)}.`;
    const now = new Date();
    await Investment.updateMany(
      { _id: { $in: relatedIds } },
      {
        $set: {
          status: 'closed',
          saleAmount: grossSale,
          outcomeType: outcomeType === 'break_even' ? 'profit' : outcomeType,
          investorProfitBalance: 0,
          'externalInvestors.$[].profitBalance': 0,
          soldAt: now,
          closedAt: now,
          ledgerLockedAt: now,
          ledgerLockedBy: String(recordedBy || 'Admin').trim(),
          updatedAt: now,
          ...(bankLedger?.entry?._id ? { bankLedgerEntryId: bankLedger.entry._id } : {}),
        },
      },
      sessionOpt(session)
    );

    // Append lock note + group P&L on primary only (avoid double-counting across siblings).
    const primaryFresh = await bindSession(Investment.findById(investment._id), session);
    if (primaryFresh) {
      primaryFresh.profit = money(Number(primaryFresh.profit || 0) + Math.max(netProfit, 0));
      primaryFresh.notes = [primaryFresh.notes || '', notes?.trim() || '', lockNote].filter(Boolean).join(' | ');
      await primaryFresh.save(sessionOpt(session));
    }

    const closedPrimary = await bindSession(
      Investment.findById(investment._id)
        .populate('investor', 'name email role phone')
        .populate('projectManager', 'name email role'),
      session
    );

    return {
      investment: closedPrimary || investment,
      sale,
      record,
      relatedInvestmentIds: relatedIds,
      settlement: {
        ...settlementPlan,
        societyCapitalReturn: societySavingsRefund,
        relatedCount: related.length,
      },
      savingsUpdate,
      distribution,
      bankLedger,
      investorLedger,
      investorLedgers,
      externalExtraExpenses: externalExtra,
      pendingExternalPayoutRequests: queued.requests || [],
      message: `Project ${investment.investmentCode} sold/closed (${saleCode}). Capital ${formatMoney(capital, 2)} across ${related.length} investment(s). Net ${formatMoney(netProceeds, 2)}. Society share settled;`
        + (externalExtra > 0 ? ` external expense ${formatMoney(externalExtra, 2)};` : '')
        + (pendingExternalPayoutTotal > 0
          ? ` external payout ${formatMoney(pendingExternalPayoutTotal, 2)} queued for External Investor approval.`
          : ' no external payout pending.')
        + ' Ledger locked.',
    };
  });

  return result;
}

async function listExternalCapitalQueue() {
  // Include projects with partial CEO/cashier deposits until fully funded.
  return Investment.find({
    status: { $in: ['active', 'pending_cashier_payment', 'pending_member_approval'] },
    externalAmount: { $gt: 0 },
    ledgerLockedAt: null,
    $expr: {
      $lt: [
        { $ifNull: ['$externalCapitalReceived', 0] },
        '$externalAmount',
      ],
    },
  })
    .populate('investor', 'name email phone')
    .populate('externalInvestors.investor', 'name email phone')
    .sort({ createdAt: -1 })
    .lean();
}

async function listActiveMonthlyProjects() {
  return Investment.find({
    status: 'active',
    returnMode: 'monthly',
    ledgerLockedAt: null,
  })
    .populate('investor', 'name email')
    .populate('externalInvestors.investor', 'name email')
    .sort({ updatedAt: -1 })
    .lean();
}

module.exports = {
  money,
  normalizeOwnership,
  splitByOwnership,
  splitByStakeholders,
  resolveProjectStakeholders,
  computeProjectLiquidationSettlement,
  assertNotLocked,
  getActiveProject,
  listRelatedActiveInvestments,
  recordExternalInvestment,
  recordCeoExternalInvestorDeposit,
  recordMonthlyProjectReturn,
  liquidateProject,
  listExternalCapitalQueue,
  listActiveMonthlyProjects,
};
