const databaseService = require('../services/databaseService');
const { buildMessageSummary } = require('../utils/messageSummary');
const { ok, fail } = require('../utils/response');
const { parsePagination } = require('../utils/paginationHelper');

const sanitizeBody = (text) => {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/<[^>]*>/g, '');
  return clean.length > 4000 ? clean.slice(0, 4000) : clean;
};

const listConversations = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const conversations = await databaseService.listConversations(userId, role, { limit, offset });

    const enriched = (conversations || []).map((c) => {
      const summary = {
        last_message_text: c.last_message_text || '',
        last_message_at: c.last_message_at || c.created_at
      };

      if (role === 'buyer') {
        const manufacturer = c.manufacturer || {};
        return {
          ...c, ...summary,
          peer: {
            id: c.manufacturer_id,
            role: 'manufacturer',
            displayName: manufacturer.manufacturer_id || manufacturer.unit_name || 'Manufacturer'
          }
        };
      }

      const buyer = c.buyer || {};
      return {
        ...c, ...summary,
        peer: {
          id: c.buyer_id,
          role: 'buyer',
          displayName: buyer.buyer_identifier || buyer.full_name || 'Buyer'
        }
      };
    });

    ok(res, { data: { conversations: enriched } });
  } catch (err) {
    fail(res, err.message || 'Failed to list conversations');
  }
};

const ensureConversation = async (req, res) => {
  try {
    const { buyerId, manufacturerId } = req.body;
    const { userId, role } = req.user;

    const isAuthorized =
      (role === 'buyer' && userId === buyerId) ||
      (role === 'manufacturer' && userId === manufacturerId);

    if (!isAuthorized) return fail(res, 'Not authorized for this conversation', 403);

    const convo = await databaseService.getOrCreateConversation(buyerId, manufacturerId);
    ok(res, { data: { conversation: convo } });
  } catch (err) {
    fail(res, err.message || 'Failed to ensure conversation');
  }
};

const listMessages = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const before = req.query.before;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const requirementId = req.params.requirementId || req.query.requirementId || null;
    const normalOnly = req.path.endsWith('/normal');

    const messages = await databaseService.listMessagesWithAttachments(
      conversationId,
      { before, limit, requirementId, normalOnly }
    );

    ok(res, { data: { messages }, count: messages.length });
  } catch (err) {
    fail(res, err.message || 'Failed to list messages');
  }
};

const sendMessage = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { userId, role } = req.user;

    const hasBody = req.body.body && req.body.body.trim().length > 0;
    const hasAttachments = Array.isArray(req.body.attachments) && req.body.attachments.length > 0;

    if (!hasBody && !hasAttachments) {
      return fail(res, 'Either body or attachments must be provided');
    }

    const cleanBody = hasBody ? sanitizeBody(req.body.body) : '';
    const summaryText = buildMessageSummary(cleanBody, hasAttachments ? req.body.attachments : []);
    const requirementId = req.body.requirementId || null;

    const message = await databaseService.insertMessage(
      conversationId, role, userId, cleanBody,
      req.body.clientTempId || null, summaryText, requirementId
    );

    let attachments = [];
    if (hasAttachments) {
      attachments = await databaseService.insertMessageAttachments(message.id, req.body.attachments);
    }

    ok(res, { data: { message: { ...message, attachments } } }, 201);
  } catch (err) {
    fail(res, err.message || 'Failed to send message');
  }
};

const markRead = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { userId } = req.user;
    const upTo = req.body.upTo || new Date().toISOString();

    const count = await databaseService.markRead(conversationId, userId, upTo);
    ok(res, { data: { updated: count } });
  } catch (err) {
    fail(res, err.message || 'Failed to mark messages as read');
  }
};

module.exports = { listConversations, ensureConversation, listMessages, sendMessage, markRead };