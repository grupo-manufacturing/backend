const databaseService = require('../services/databaseService');

async function requireConversationAccess(req, res, next) {
  try {
    const conversationId = req.params.id;
    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    const isAllowed = !!convo && (
      (role === 'buyer' && convo.buyer_id === userId) ||
      (role === 'manufacturer' && convo.manufacturer_id === userId)
    );

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this conversation' });
    }

    req.conversation = convo;
    return next();
  } catch (error) {
    console.error('Conversation authorization error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to authorize conversation access' });
  }
}

module.exports = {
  requireConversationAccess
};
