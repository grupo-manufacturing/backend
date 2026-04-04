const express = require('express');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { createQr, submitUtr, getStatus, getMyPayments, getPendingAdmin, verifyPayment, refundPayment } = require('../controllers/paymentController');

const router = express.Router();

router.post('/create-qr', authenticateToken, createQr);
router.post('/submit-utr', authenticateToken, submitUtr);
router.get('/status/:requirementResponseId', authenticateToken, getStatus);
router.get('/my-payments', authenticateToken, getMyPayments);
router.get('/admin/pending', authenticateAdmin, getPendingAdmin);
router.post('/verify/:paymentId', authenticateAdmin, verifyPayment);
router.post('/refund/:paymentId', authenticateAdmin, refundPayment);

module.exports = router;