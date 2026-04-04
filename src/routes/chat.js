const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { requireConversationAccess } = require('../middleware/conversationAuth');
const { validate } = require('../middleware/validate');
const { listConversations, ensureConversation, listMessages, sendMessage, markRead } = require('../controllers/chatController');

const router = express.Router();

const conversationIdParam = param('id').isUUID();
const paginationQuery = [
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 200 })
];

router.get('/conversations', authenticateToken, listConversations);

router.post('/conversations',
  [
    body('buyerId').isUUID().withMessage('buyerId must be a valid UUID'),
    body('manufacturerId').isUUID().withMessage('manufacturerId must be a valid UUID')
  ],
  validate,
  authenticateToken,
  ensureConversation
);

router.get('/conversations/:id/messages/requirement/:requirementId',
  [conversationIdParam, param('requirementId').isUUID(), ...paginationQuery],
  validate,
  authenticateToken,
  requireConversationAccess,
  listMessages
);

router.get('/conversations/:id/messages/normal',
  [conversationIdParam, ...paginationQuery],
  validate,
  authenticateToken,
  requireConversationAccess,
  listMessages
);

router.get('/conversations/:id/messages',
  [conversationIdParam, ...paginationQuery, query('requirementId').optional().isUUID()],
  validate,
  authenticateToken,
  requireConversationAccess,
  listMessages
);

router.post('/conversations/:id/messages',
  [
    conversationIdParam,
    body('body').optional().isString().isLength({ max: 4000 }),
    body('clientTempId').optional().isString().isLength({ max: 64 }),
    body('attachments').optional().isArray(),
    body('requirementId').optional().isUUID()
  ],
  validate,
  authenticateToken,
  requireConversationAccess,
  sendMessage
);

router.post('/conversations/:id/read',
  [conversationIdParam, body('upTo').optional().isISO8601()],
  validate,
  authenticateToken,
  requireConversationAccess,
  markRead
);

module.exports = router;