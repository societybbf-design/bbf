'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('transaction audit router exports PDF handlers and imports generateAuditTrailPdf', () => {
  const router = require('../routes/transactionAudit');
  assert.equal(typeof router, 'function');

  const { generateAuditTrailPdf } = require('../services/documentPdfService');
  assert.equal(typeof generateAuditTrailPdf, 'function');

  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path)
    .sort();
  assert.ok(paths.includes('/export.pdf'));
  assert.ok(paths.includes('/export_pdf'));
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/categories'));
});
