const router = require('express').Router();
const {
  queryAuditTransactions,
  AUDIT_CATEGORIES,
} = require('../services/transactionAuditService');
const { generateAuditTrailPdf } = require('../services/documentPdfService');
const { resolveRequestLanguage } = require('../services/i18nService');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits', 'can_view_reports'));

router.get('/categories', (req, res) => {
  res.json({ categories: AUDIT_CATEGORIES });
});

router.get('/', async (req, res) => {
  try {
    const result = await queryAuditTransactions({
      from: req.query.from,
      to: req.query.to,
      category: req.query.category || 'all',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load transaction audit trail.' });
  }
});

async function exportAuditPdf(req, res) {
  try {
    const result = await queryAuditTransactions({
      from: req.query.from,
      to: req.query.to,
      category: req.query.category || 'all',
      limit: req.query.limit || 500,
      offset: req.query.offset || 0,
    });

    const lang = resolveRequestLanguage(req);
    const pdfBuffer = await generateAuditTrailPdf(result, req.session?.user?.name || 'Cashier', lang);
    const fromPart = req.query.from || 'all';
    const toPart = req.query.to || 'dates';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="society-audit-${fromPart}-to-${toPart}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('transaction audit PDF export failed:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Unable to export audit trail PDF.' });
  }
}

// Primary path used by Cashier UI
router.get('/export.pdf', exportAuditPdf);
// Compatibility alias (some clients/openers hit export_pdf)
router.get('/export_pdf', exportAuditPdf);

module.exports = router;
