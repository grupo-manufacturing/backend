const databaseService = require('../services/databaseService');

const requireConversationAccess = async (req, res, next) => {
  try {
    const convo = await databaseService.getConversation(req.params.id);
    const { userId, role } = req.user;

    const isAllowed = !!convo && (
      (role === 'buyer' && convo.buyer_id === userId) ||
      (role === 'manufacturer' && convo.manufacturer_id === userId)
    );

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this conversation' });
    }

    req.conversation = convo;
    next();
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Failed to authorize conversation access' });
  }
};

module.exports = { requireConversationAccess };