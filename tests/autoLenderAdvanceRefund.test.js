'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sectionForNotification,
  resolveNotificationHref,
} = require('../services/notificationLinkService');
const { AUDIT_CATEGORIES } = require('../services/transactionAuditService');
const serviceJs = fs.readFileSync(path.join(__dirname, '../services/advanceBorrowingService.js'), 'utf8');
const loanRepayJs = fs.readFileSync(path.join(__dirname, '../services/loanRepaymentService.js'), 'utf8');
const auditJs = fs.readFileSync(path.join(__dirname, '../services/transactionAuditService.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');

test('flexible availability uses savings + advance without arbitrary blocks', () => {
  assert.match(serviceJs, /borrowerSavingsBefore \+ borrowerAdvanceBefore/);
  assert.match(serviceJs, /savings first, then the borrower's own advance balance/);
  assert.match(serviceJs, /deductedFromSavings/);
  assert.match(serviceJs, /deductedFromAdvance/);
});

test('settlement instantly credits lender advance and notifies with portfolio link', () => {
  assert.match(serviceJs, /\$inc:\s*\{\s*advanceBalance:\s*payAmount\s*\}/);
  assert.match(serviceJs, /async function notifyLenderAdvanceRefund/);
  assert.match(serviceJs, /Your funded amount of/);
  assert.match(serviceJs, /has been successfully returned and added to your Advance Balance/);
  assert.match(serviceJs, /link:\s*'portfolio'/);
  assert.match(serviceJs, /relatedModel:\s*'InternalBorrowing'/);
  assert.match(serviceJs, /createMemberNotification/);
  assert.match(serviceJs, /type:\s*'deposit'/);
});

test('loan repayment auto-settles funding with skipBankCredit to avoid double bank credit', () => {
  assert.match(loanRepayJs, /settleLoanFundingOnRepayment/);
  assert.match(loanRepayJs, /settleInternalBorrowing/);
  assert.match(loanRepayJs, /cashReceived:\s*true/);
  assert.match(loanRepayJs, /skipBankCredit:\s*true/);
});

test('notification deep-link routes lenders to member portfolio / advance ledger', () => {
  assert.equal(
    sectionForNotification({
      type: 'deposit',
      relatedModel: 'InternalBorrowing',
      title: 'Advance balance refunded',
    }),
    'portfolio'
  );
  assert.equal(
    sectionForNotification({
      title: 'Your funded amount of ৳100 for project INV-1 has been successfully returned',
    }),
    'portfolio'
  );
  assert.equal(
    sectionForNotification({ link: 'portfolio' }),
    'portfolio'
  );
  assert.equal(resolveNotificationHref('portfolio', 'member'), '/member#portfolio');
  assert.equal(resolveNotificationHref('advances', 'member'), '/member#portfolio');
});

test('transaction audit includes advance_refunds from borrow_repayment deposits', () => {
  assert.ok(AUDIT_CATEGORIES.some((c) => c.key === 'advance_refunds'));
  assert.match(auditJs, /type:\s*'borrow_repayment'/);
  assert.match(auditJs, /category:\s*'advance_refunds'/);
  assert.match(auditJs, /advanceRefundDepositToTransaction/);
});

test('member portfolio surfaces advance balance and borrowings for lender deep-link', () => {
  assert.match(memberHtml, /id="portfolioAdvanceBalance"/);
  assert.match(memberHtml, /id="portfolioBorrowingsBody"/);
  assert.match(memberHtml, /Advance funding &amp; internal borrows/);
  assert.match(memberJs, /refreshPortfolioAdvanceSummary/);
  assert.match(memberJs, /portfolioBorrowingsBody/);
  assert.match(memberJs, /if \(page === 'portfolio'/);
});
