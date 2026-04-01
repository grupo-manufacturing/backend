const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const { buildMessageSummary } = require('../utils/messageSummary');
const { parsePagination } = require('../utils/paginationHelper');

const router = express.Router();

const sanitizeBody = (text) => {
  if (typeof text !== 'string') return '';
  const noHtml = text.replace(/<[^>]*>/g, '');
  return noHtml.length > 4000 ? noHtml.slice(0, 4000) : noHtml;
};

// GET /conversations - List user's conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    // Get conversations with related data (buyer/manufacturer profiles) and unread counts
    // This is now optimized to avoid N+1 queries
    const conversations = await databaseService.listConversations(userId, role, { limit, offset });

    // Enrich conversations with peer information using data already fetched via JOINs
    const enriched = (conversations || []).map((c) => {
      try {
        // Use last_message_text and last_message_at from conversation (updated on message insert)
        const summary = {
          last_message_text: c.last_message_text || '',
          last_message_at: c.last_message_at || c.created_at
        };

        // Use profile data already fetched via JOINs
        if (role === 'buyer') {
          const manufacturer = c.manufacturer || {};
          return {
            ...c,
            ...summary,
            peer: {
              id: c.manufacturer_id,
              role: 'manufacturer',
              displayName: manufacturer.manufacturer_id || manufacturer.unit_name || 'Manufacturer'
            }
          };
        } else {
          const buyer = c.buyer || {};
          return {
            ...c,
            ...summary,
            peer: {
              id: c.buyer_id,
              role: 'buyer',
              displayName: buyer.buyer_identifier || buyer.full_name || 'Buyer'
            }
          };
        }
      } catch (err) {
        console.error('Error enriching conversation:', err);
        return c;
      }
    });

    res.status(200).json({ success: true, data: { conversations: enriched } });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to list conversations' });
  }
});

// POST /conversations - Ensure/get conversation for buyerId + manufacturerId
router.post('/conversations', [
  body('buyerId').isUUID().withMessage('buyerId must be a valid UUID'),
  body('manufacturerId').isUUID().withMessage('manufacturerId must be a valid UUID')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { buyerId, manufacturerId } = req.body;
    const { userId, role } = req.user;

    if (!((role === 'buyer' && userId === buyerId) || (role === 'manufacturer' && userId === manufacturerId))) {
      return res.status(403).json({ success: false, message: 'Not authorized for this conversation' });
    }

    const convo = await databaseService.getOrCreateConversation(buyerId, manufacturerId);
    res.status(200).json({ success: true, data: { conversation: convo } });
  } catch (error) {
    console.error('Ensure conversation error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to ensure conversation' });
  }
});

// GET /conversations/:id/messages/requirement/:requirementId - Get messages for specific requirement
router.get('/conversations/:id/messages/requirement/:requirementId', [
  param('id').isUUID(),
  param('requirementId').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 200 })
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const requirementId = req.params.requirementId;
    const before = req.query.before;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, requirementId });
    
    return res.status(200).json({ 
      success: true, 
      data: { messages },
      count: messages.length 
    });
  } catch (error) {
    console.error('List messages by requirement error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// GET /conversations/:id/messages/normal - Get normal (non-requirement) messages
router.get('/conversations/:id/messages/normal', [
  param('id').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 200 })
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const before = req.query.before;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, normalOnly: true });
    
    return res.status(200).json({ 
      success: true, 
      data: { messages },
      count: messages.length 
    });
  } catch (error) {
    console.error('List normal messages error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// GET /conversations/:id/messages - Paginate history
router.get('/conversations/:id/messages', [
  param('id').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('requirementId').optional().isUUID()
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const before = req.query.before;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const requirementId = req.query.requirementId || null;

    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, requirementId });
    res.status(200).json({ success: true, data: { messages } });
  } catch (error) {
    console.error('List messages error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// POST /conversations/:id/messages - Send message
router.post('/conversations/:id/messages', [
  param('id').isUUID(),
  body('body').optional().isString().isLength({ max: 4000 }),
  body('clientTempId').optional().isString().isLength({ max: 64 }),
  body('attachments').optional().isArray(),
  body('requirementId').optional().isUUID()
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const { userId, role } = req.user;
    const convo = await databaseService.getConversation(conversationId);

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to send in this conversation' });
    }

    const hasBody = req.body.body && req.body.body.trim().length > 0;
    const hasAttachments = req.body.attachments && Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
    
    if (!hasBody && !hasAttachments) {
      return res.status(400).json({ success: false, message: 'Either body or attachments must be provided' });
    }

    const cleanBody = hasBody ? sanitizeBody(req.body.body) : '';
    const summaryText = buildMessageSummary(cleanBody, hasAttachments ? req.body.attachments : []);
    const requirementId = req.body.requirementId || null;
    const message = await databaseService.insertMessage(conversationId, role, userId, cleanBody, req.body.clientTempId || null, summaryText, requirementId);

    let attachments = [];
    if (hasAttachments) {
      attachments = await databaseService.insertMessageAttachments(message.id, req.body.attachments);
    }

    const messageWithAttachments = { ...message, attachments };

    res.status(201).json({ success: true, data: { message: messageWithAttachments } });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to send message' });
  }
});

// POST /conversations/:id/read - Mark as read
router.post('/conversations/:id/read', [
  param('id').isUUID(),
  body('upTo').optional().isISO8601()
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const { userId, role } = req.user;
    const convo = await databaseService.getConversation(conversationId);

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to mark read in this conversation' });
    }

    const upTo = req.body.upTo || new Date().toISOString();
    const count = await databaseService.markRead(conversationId, userId, upTo);
    res.status(200).json({ success: true, data: { updated: count } });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to mark messages as read' });
  }
});

module.exports = router;
