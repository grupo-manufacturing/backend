const express = require('express');
const { body } = require('express-validator');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  create, getAll, getBuyerStatistics, getActiveForConversation,
  getOne, update, remove,
  createResponse, getMyResponses, getResponses, getResponseById,
  updateResponseStatus, getAdminOrders, getAdminMetrics
} = require('../controllers/requirementController');

const router = express.Router();

const MIN_QUANTITY = 30;

const createRules = [
  body('product_type').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('quantity').notEmpty().isInt({ min: MIN_QUANTITY }).withMessage(`Quantity must be at least ${MIN_QUANTITY}`),
  body('requirement_text').optional({ checkFalsy: true }).trim().isLength({ max: 5000 }),
  body('product_link').optional({ checkFalsy: true }).trim().isURL({ require_protocol: false, allow_underscores: true }),
  body('image_url').optional({ checkFalsy: true }).trim().isURL({ require_protocol: false, allow_underscores: true }),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 2000 })
];

const updateRules = [
  body('requirement_text').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('quantity').optional({ nullable: true }).custom((value) => {
    if (value === null || value === '') return true;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < MIN_QUANTITY) throw new Error(`Quantity must be at least ${MIN_QUANTITY}`);
    return true;
  }),
  body('product_type').optional({ nullable: true }).isString().isLength({ min: 1, max: 255 }),
  body('product_link').optional({ nullable: true, checkFalsy: true }).isURL({ require_protocol: false, allow_underscores: true }),
  body('image_url').optional({ nullable: true, checkFalsy: true }).isURL({ require_protocol: false, allow_underscores: true }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 })
];

const responseRules = [
  body('quoted_price').notEmpty().isFloat({ gt: 0 }),
  body('price_per_unit').notEmpty().isFloat({ gt: 0 }),
  body('delivery_time').notEmpty().isString().isLength({ min: 1, max: 255 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 })
];

router.post('/', authenticateToken, createRules, validate, create);
router.get('/', authenticateToken, getAll);

router.get('/buyer/statistics', authenticateToken, getBuyerStatistics);
router.get('/conversation/:conversationId/active-requirements', authenticateToken, getActiveForConversation);
router.get('/responses/my-responses', authenticateToken, getMyResponses);
router.get('/responses/:responseId', authenticateToken, getResponseById);
router.patch('/responses/:responseId/status', authenticateToken, updateResponseStatus);
router.get('/admin/orders', authenticateAdmin, getAdminOrders);
router.get('/admin/metrics/overview', authenticateAdmin, getAdminMetrics);

router.get('/:id', authenticateToken, getOne);
router.put('/:id', authenticateToken, updateRules, validate, update);
router.delete('/:id', authenticateToken, remove);
router.post('/:id/responses', authenticateToken, responseRules, validate, createResponse);
router.get('/:id/responses', authenticateToken, getResponses);

module.exports = router;