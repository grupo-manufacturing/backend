const supabase = require('../../config/supabase');
const databaseService = require('../../services/databaseService');
const { buildMessageSummary } = require('../../utils/messageSummary');

const sanitize = (text) =>
  typeof text === 'string' ? text.replace(/<[^>]*>/g, '').slice(0, 4000) : '';

const isParticipant = (convo, userId, role) =>
  (role === 'buyer' && convo.buyer_id === userId) ||
  (role === 'manufacturer' && convo.manufacturer_id === userId);

const onMessageSend = (io) => async (socket, { conversationId, body, clientTempId, attachments, requirementId }) => {
  try {
    if (!conversationId) return;

    const hasBody = body && typeof body === 'string' && body.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasBody && !hasAttachments) return;

    const convo = await databaseService.getConversation(conversationId);
    if (!convo) return;

    const { userId, role } = socket.user;
    if (!isParticipant(convo, userId, role)) return;

    const sanitized = hasBody ? sanitize(body) : '';
    const summaryText = buildMessageSummary(sanitized, hasAttachments ? attachments : []);
    const message = await databaseService.insertMessage(
      conversationId, role, userId, sanitized,
      clientTempId || null, summaryText, requirementId || null
    );

    let messageAttachments = [];
    if (hasAttachments) {
      messageAttachments = await databaseService.insertMessageAttachments(message.id, attachments);
    }

    const refreshed = await databaseService.getConversation(conversationId);

    io.to(`user:${convo.buyer_id}`).to(`user:${convo.manufacturer_id}`).emit('message:new', {
      message: { ...message, attachments: messageAttachments },
      conversationSummary: {
        id: refreshed.id,
        last_message_at: refreshed.last_message_at,
        last_message_text: refreshed.last_message_text,
        is_archived: refreshed.is_archived
      }
    });
  } catch (err) {
    console.error('WS message:send error:', err);
  }
};

const onMessageRead = (io) => async (socket, { conversationId, upToMessageId }) => {
  try {
    if (!conversationId) return;

    const convo = await databaseService.getConversation(conversationId);
    if (!convo) return;

    const { userId, role } = socket.user;
    if (!isParticipant(convo, userId, role)) return;

    let upTo = new Date().toISOString();
    if (upToMessageId) {
      const { data: msg, error } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', upToMessageId)
        .single();
      if (!error && msg) upTo = msg.created_at;
    }

    await databaseService.markRead(conversationId, userId, upTo);

    io.to(`user:${convo.buyer_id}`).to(`user:${convo.manufacturer_id}`).emit('message:read', {
      conversationId,
      readerUserId: userId,
      upToMessageId: upToMessageId || null,
      at: upTo
    });
  } catch (err) {
    console.error('WS message:read error:', err);
  }
};

module.exports = { onMessageSend, onMessageRead };