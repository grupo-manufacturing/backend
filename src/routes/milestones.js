const express = require('express');
const { body, param } = require('express-validator');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { complete, approve, markPaid, getPendingPayouts, markFinalPaid, getStatus } = require('../controllers/milestoneController');

const router = express.Router();

const responseIdParam = param('responseId').isUUID().withMessage('responseId must be a valid UUID');
const milestoneBody = body('milestone').isIn(['m1', 'm2']).withMessage('milestone must be m1 or m2');
const transactionRefBody = body('transactionRef')
  .optional({ nullable: true })
  .isString()
  .isLength({ max: 100 })
  .withMessage('transactionRef must be at most 100 characters');

router.post('/complete',
  authenticateToken,
  [
    body('responseId').isUUID().withMessage('responseId must be a valid UUID'),
    milestoneBody
  ],
  validate,
  complete
);

router.post('/approve/:responseId',
  authenticateToken,
  [responseIdParam, milestoneBody],
  validate,
  approve
);

router.post('/mark-paid/:responseId',
  authenticateAdmin,
  [responseIdParam, milestoneBody, transactionRefBody],
  validate,
  markPaid
);

router.get('/pending-payouts', authenticateAdmin, getPendingPayouts);

router.post('/mark-final-paid/:responseId',
  authenticateAdmin,
  [responseIdParam, transactionRefBody],
  validate,
  markFinalPaid
);

router.get('/status/:responseId', authenticateToken, getStatus);

module.exports = router;