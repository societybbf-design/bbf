const Deposit = require('../models/Deposit');
const User = require('../models/User');
const MonthlyContributionDue = require('../models/MonthlyContributionDue');
const {
  createPdfBuffer,
  drawBrandHeader,
  drawSummaryCards,
  drawSectionTitle,
  drawDataTable,
  addPageNumbers,
  money: pdfMoney,
} = require('./documentPdfService');
const {
  yearMonthFromDate,
  parseYearMonth,
  getTargetForMonth,
  syncMonthDues,
} = require('./monthlyTargetService');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function getMonthRange(referenceDate = new Date()) {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);
  const monthLabel = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const yearMonth = yearMonthFromDate(monthStart);
  return { monthStart, monthEnd, monthLabel, yearMonth };
}

async function getMonthlyContributionReport(referenceDate = new Date()) {
  const { monthStart, monthEnd, monthLabel, yearMonth } = getMonthRange(referenceDate);
  const target = await getTargetForMonth(yearMonth);
  const expectedAmount = target.amount;

  if (expectedAmount != null) {
    await syncMonthDues(yearMonth, { expectedAmount });
  }

  const members = await User.find({ role: 'member', status: 'active' })
    .select('name email phone savings advanceBalance')
    .sort({ name: 1 })
    .lean();

  const dues = await MonthlyContributionDue.find({ yearMonth }).lean();
  const duesByMember = new Map(dues.map((d) => [String(d.member), d]));

  const deposits = await Deposit.find({
    $or: [
      { yearMonth },
      {
        yearMonth: { $in: ['', null] },
        createdAt: { $gte: monthStart, $lt: monthEnd },
        type: { $in: ['regular', 'advance'] },
      },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  const depositsByMember = new Map();
  deposits.forEach((deposit) => {
    const memberId = String(deposit.member);
    if (!depositsByMember.has(memberId)) {
      depositsByMember.set(memberId, []);
    }
    depositsByMember.get(memberId).push(deposit);
  });

  const paid = [];
  const unpaid = [];
  const partial = [];

  members.forEach((member) => {
    const memberId = String(member._id);
    const memberDeposits = depositsByMember.get(memberId) || [];
    const due = duesByMember.get(memberId);
    const depositAmount = money(
      memberDeposits
        .filter((d) => d.type === 'regular' || !d.type)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );
    const advanceSurplus = money(
      memberDeposits
        .filter((d) => d.type === 'advance')
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );

    const paidAmount = due ? money(due.paidAmount) : depositAmount;
    const unpaidAmount = due
      ? money(due.unpaidAmount)
      : expectedAmount != null
        ? money(Math.max(0, expectedAmount - depositAmount))
        : 0;
    const status = due?.status
      || (expectedAmount == null
        ? (depositAmount > 0 ? 'paid' : 'unpaid')
        : unpaidAmount <= 0
          ? 'paid'
          : paidAmount > 0
            ? 'partial'
            : 'unpaid');

    const row = {
      member,
      memberId: member._id,
      amount: paidAmount,
      unpaidAmount,
      surplusToAdvance: due ? money(due.surplusToAdvance) : advanceSurplus,
      depositCount: memberDeposits.length,
      lastDepositDate: memberDeposits[0]?.createdAt || null,
      status,
      expectedAmount: due ? money(due.expectedAmount) : expectedAmount || 0,
    };

    if (status === 'paid' || (expectedAmount == null && depositAmount > 0)) {
      paid.push(row);
    } else if (status === 'partial') {
      partial.push(row);
      unpaid.push(row);
    } else {
      unpaid.push(row);
    }
  });

  const paidTotal = paid.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const unpaidTotal = unpaid.reduce((sum, row) => sum + Number(row.unpaidAmount || 0), 0);

  return {
    monthLabel,
    yearMonth,
    expectedAmount,
    targetSource: target.source,
    targetConfigured: target.configured,
    paidTotal: money(paidTotal),
    unpaidTotal: money(unpaidTotal),
    paidCount: paid.length,
    unpaidCount: unpaid.length,
    partialCount: partial.length,
    paid,
    unpaid,
    partial,
  };
}

function generateMonthlyContributionReportPdf(report = {}, type = 'paid') {
  const rows = type === 'unpaid' ? report.unpaid || [] : report.paid || [];
  const title = type === 'unpaid' ? 'Members With Outstanding Dues' : 'Members Paid This Month';

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, {
      title: 'Monthly Contribution Report',
      subtitle: `${report.monthLabel || 'Current Month'} · ${title}`,
      generatedBy: 'Admin',
    });

    drawSummaryCards(doc, type === 'paid'
      ? [
        { label: 'Month target', value: report.expectedAmount != null ? pdfMoney(report.expectedAmount) : '—' },
        { label: 'Applied to target', value: pdfMoney(report.paidTotal) },
        { label: 'Members paid', value: String(report.paidCount || 0) },
        { label: 'Listed', value: String(rows.length) },
      ]
      : [
        { label: 'Month target', value: report.expectedAmount != null ? pdfMoney(report.expectedAmount) : '—' },
        { label: 'Outstanding', value: pdfMoney(report.unpaidTotal) },
        { label: 'Members with dues', value: String(report.unpaidCount || 0) },
        { label: 'Listed', value: String(rows.length) },
      ]);

    drawSectionTitle(doc, title);
    drawDataTable(doc, {
      columns: type === 'paid'
        ? [
          { label: '#', width: 0.08, type: 'number', format: (_row, index) => String(index + 1) },
          { label: 'Member', width: 0.28, format: (row) => row.member?.name || 'Unknown' },
          { label: 'Email', width: 0.28, format: (row) => row.member?.email || '—' },
          { label: 'Paid', width: 0.18, type: 'money', format: (row) => pdfMoney(row.amount) },
          { label: 'Surplus', width: 0.18, type: 'money', format: (row) => pdfMoney(row.surplusToAdvance) },
        ]
        : [
          { label: '#', width: 0.08, type: 'number', format: (_row, index) => String(index + 1) },
          { label: 'Member', width: 0.24, format: (row) => row.member?.name || 'Unknown' },
          { label: 'Email', width: 0.24, format: (row) => row.member?.email || '—' },
          { label: 'Expected', width: 0.14, type: 'money', format: (row) => pdfMoney(row.expectedAmount ?? report.expectedAmount) },
          { label: 'Paid', width: 0.14, type: 'money', format: (row) => pdfMoney(row.amount) },
          { label: 'Due', width: 0.16, type: 'money', format: (row) => pdfMoney(row.unpaidAmount) },
        ],
      rows,
      emptyText: 'No records for this list.',
    });

    addPageNumbers(doc);
  });
}

module.exports = {
  getMonthRange,
  getMonthlyContributionReport,
  generateMonthlyContributionReportPdf,
  parseYearMonth,
};
