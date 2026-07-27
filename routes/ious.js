const router = require('express').Router();
const {
  createInvestmentIou,
  deleteInvestmentIou,
  generateIouCode,
  getAllIous,
  getIouById,
} = require('../services/iouService');
const { generateIouReceiptPdf } = require('../services/notificationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_ious'));

router.get('/preview-code', async (req, res) => {
  try {
    const iouCode = await generateIouCode();
    return res.json({ iouCode });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate IOU code preview.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const ious = await getAllIous();
    return res.json({ ious });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investment IOUs.' });
  }
});

router.get('/:id/receipt', async (req, res) => {
  try {
    const iou = await getIouById(req.params.id);
    const pdfBuffer = await generateIouReceiptPdf(
      iou,
      req.session?.user?.name || 'Admin'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="iou-${iou._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate IOU receipt.' });
  }
});

router.post('/', requirePasswordConfirmation, async (req, res) => {
  try {
    const { investorName, dateOfBirth, location, amount, notes } = req.body;
    const iou = await createInvestmentIou({
      investorName,
      dateOfBirth,
      location,
      amount,
      notes,
      createdBy: req.session?.user?.name || 'Admin',
    });
    return res.status(201).json({ iou });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save investment IOU.' });
  }
});

router.delete('/:id', requirePasswordConfirmation, async (req, res) => {
  try {
    const iou = await deleteInvestmentIou(req.params.id);
    return res.json({ iou });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to delete investment IOU.' });
  }
});

module.exports = router;
