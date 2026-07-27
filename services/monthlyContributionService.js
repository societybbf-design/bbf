const PDFDocument = require('pdfkit');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const MonthlyContributionDue = require('../models/MonthlyContributionDue');
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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#0f172a').text('Society Monthly Contribution Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#475569').text(report.monthLabel || 'Current Month', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(16).fillColor('#111827').text(title);
    doc.moveDown(0.5);

    if (report.expectedAmount != null) {
      doc.fontSize(12).fillColor('#334155').text(
        `Month target per member: $${Number(report.expectedAmount).toFixed(2)}`
      );
    }

    if (type === 'paid') {
      doc.fontSize(12).fillColor('#334155').text(`Total applied to target: $${Number(report.paidTotal || 0).toFixed(2)}`);
      doc.text(`Members fully paid: ${report.paidCount || 0}`);
    } else {
      doc.fontSize(12).fillColor('#334155').text(`Outstanding: $${Number(report.unpaidTotal || 0).toFixed(2)}`);
      doc.text(`Members with dues: ${report.unpaidCount || 0}`);
    }

    doc.moveDown(1);
    doc.fontSize(11).fillColor('#0f172a');

    if (!rows.length) {
      doc.text('No records for this list.');
    } else {
      rows.forEach((row, index) => {
        const member = row.member || {};
        doc.font('Helvetica-Bold').text(`${index + 1}. ${member.name || 'Unknown Member'}`);
        doc.font('Helvetica').fillColor('#334155');
        doc.text(`Email: ${member.email || 'N/A'}`);
        if (type === 'paid') {
          doc.text(`Paid toward target: $${Number(row.amount || 0).toFixed(2)}`);
          if (row.surplusToAdvance > 0) {
            doc.text(`Surplus to advance: $${Number(row.surplusToAdvance || 0).toFixed(2)}`);
          }
          doc.text(`Deposits: ${row.depositCount || 0}`);
          if (row.lastDepositDate) {
            doc.text(`Last payment: ${new Date(row.lastDepositDate).toLocaleString()}`);
          }
        } else {
          doc.text(`Expected: $${Number(row.expectedAmount || report.expectedAmount || 0).toFixed(2)}`);
          doc.text(`Paid: $${Number(row.amount || 0).toFixed(2)}`);
          doc.text(`Still due: $${Number(row.unpaidAmount || 0).toFixed(2)}`);
          doc.text(`Status: ${row.status || 'unpaid'}`);
        }
        doc.moveDown(0.6);
        doc.fillColor('#0f172a');
      });
    }

    doc.end();
  });
}

module.exports = {
  getMonthRange,
  getMonthlyContributionReport,
  generateMonthlyContributionReportPdf,
  parseYearMonth,
};
