/**
 * Conversation Repository - Conversations and Messages management
 */
const { supabase } = require('./BaseRepository');

class ConversationRepository {
  /**
   * Get or create a conversation between a buyer and a manufacturer
   */
  async getOrCreateConversation(buyerId, manufacturerId) {
    try {
      // Try to find existing
      let { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('buyer_id', buyerId)
        .eq('manufacturer_id', manufacturerId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to fetch conversation: ${error.message}`);
      }

      if (!data) {
        // Create new conversation
        const insert = await supabase
          .from('conversations')
          .insert([{ buyer_id: buyerId, manufacturer_id: manufacturerId }])
          .select('*')
          .single();
        if (insert.error) {
          // If unique constraint hit due to race, fetch again
          if (insert.error.code === '23505') {
            const retry = await supabase
              .from('conversations')
              .select('*')
              .eq('buyer_id', buyerId)
              .eq('manufacturer_id', manufacturerId)
              .single();
            if (retry.error) throw new Error(`Failed to fetch conversation after conflict: ${retry.error.message}`);
            return retry.data;
          }
          throw new Error(`Failed to create conversation: ${insert.error.message}`);
        }
        return insert.data;
      }

      return data;
    } catch (error) {
      console.error('ConversationRepository.getOrCreateConversation error:', error);
      throw error;
    }
  }

  /**
   * List conversations for a user based on role
   * Optimized to avoid N+1 queries by using batch queries instead of individual queries per conversation
   */
  async listConversations(userId, role, { search, limit = 50, cursor, offset = 0 } = {}) {
    try {
      // Build the main query
      let query = supabase
        .from('conversations')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit)
        .range(offset, offset + limit - 1);

      if (role === 'buyer') {
        query = query.eq('buyer_id', userId);
      } else if (role === 'manufacturer') {
        query = query.eq('manufacturer_id', userId);
      }

      if (cursor) {
        query = query.lt('last_message_at', cursor);
      }

      if (search && typeof search === 'string' && search.trim().length > 0) {
        query = query.ilike('last_message_text', `%${search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to list conversations: ${error.message}`);
      }
      const conversations = data || [];

      // If no conversations, return early
      if (conversations.length === 0) {
        return conversations.map(c => ({ ...c, unread_count: 0 }));
      }

      const conversationIds = conversations.map(c => c.id);

      // Batch fetch unread counts for all conversations in a single query
      const { data: unreadMessages, error: unreadError } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .eq('is_read', false)
        .neq('sender_id', userId);

      // Count unread messages per conversation
      const unreadCountsMap = {};
      if (!unreadError && unreadMessages && Array.isArray(unreadMessages)) {
        unreadMessages.forEach(msg => {
          unreadCountsMap[msg.conversation_id] = (unreadCountsMap[msg.conversation_id] || 0) + 1;
        });
      } else if (unreadError) {
        console.error('ConversationRepository.listConversations unread count error:', unreadError);
      }

      // Collect unique profile IDs for batch fetching
      const buyerIds = new Set();
      const manufacturerIds = new Set();
      
      conversations.forEach(c => {
        if (c.buyer_id) buyerIds.add(c.buyer_id);
        if (c.manufacturer_id) manufacturerIds.add(c.manufacturer_id);
      });

      // Batch fetch all buyer profiles in one query
      let buyerProfilesMap = {};
      if (buyerIds.size > 0) {
        const { data: buyers, error: buyerError } = await supabase
          .from('buyer_profiles')
          .select('id, buyer_identifier, full_name')
          .in('id', Array.from(buyerIds));

        if (!buyerError && buyers) {
          buyers.forEach(buyer => {
            buyerProfilesMap[buyer.id] = buyer;
          });
        } else if (buyerError) {
          console.error('ConversationRepository.listConversations buyer profiles error:', buyerError);
        }
      }

      // Batch fetch all manufacturer profiles in one query
      let manufacturerProfilesMap = {};
      if (manufacturerIds.size > 0) {
        const { data: manufacturers, error: manufacturerError } = await supabase
          .from('manufacturer_profiles')
          .select('id, manufacturer_id, unit_name')
          .in('id', Array.from(manufacturerIds));

        if (!manufacturerError && manufacturers) {
          manufacturers.forEach(manufacturer => {
            manufacturerProfilesMap[manufacturer.id] = manufacturer;
          });
        } else if (manufacturerError) {
          console.error('ConversationRepository.listConversations manufacturer profiles error:', manufacturerError);
        }
      }

      // Enrich conversations with unread counts and profile data
      const enriched = conversations.map(conversation => ({
        ...conversation,
        unread_count: unreadCountsMap[conversation.id] || 0,
        buyer: buyerProfilesMap[conversation.buyer_id] || null,
        manufacturer: manufacturerProfilesMap[conversation.manufacturer_id] || null
      }));

      return enriched;
    } catch (error) {
      console.error('ConversationRepository.listConversations error:', error);
      throw error;
    }
  }

  /**
   * Check if user is participant of conversation
   */
  async getConversation(conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();
    if (error) {
      throw new Error(`Failed to fetch conversation: ${error.message}`);
    }
    return data;
  }

  /**
   * Insert a new message and update conversation summary
   */
  async insertMessage(conversationId, senderRole, senderId, body, clientTempId, summaryText, requirementId = null, aiDesignId = null) {
    try {
      const messageData = {
        conversation_id: conversationId,
        sender_role: senderRole,
        sender_id: senderId,
        body,
        client_temp_id: clientTempId
      };
      
      if (requirementId) {
        messageData.requirement_id = requirementId;
      }
      
      if (aiDesignId) {
        messageData.ai_design_id = aiDesignId;
      }

      const { data, error } = await supabase
        .from('messages')
        .insert([messageData])
        .select('*')
        .single();
      if (error) {
        throw new Error(`Failed to insert message: ${error.message}`);
      }

      const updated = await supabase
        .from('conversations')
        .update({ last_message_at: data.created_at, last_message_text: summaryText ?? body })
        .eq('id', conversationId)
        .select('id')
        .single();
      if (updated.error) {
        console.warn('Failed to update conversation summary:', updated.error.message);
      }

      return data;
    } catch (error) {
      console.error('ConversationRepository.insertMessage error:', error);
      throw error;
    }
  }

  /**
   * Insert message attachments
   * @param {string} messageId - Message ID
   * @param {Array} attachments - Array of attachment objects
   * @returns {Promise<Array>} Array of inserted attachments
   */
  async insertMessageAttachments(messageId, attachments) {
    try {
      if (!attachments || attachments.length === 0) {
        return [];
      }

      const attachmentRecords = attachments.map(att => ({
        message_id: messageId,
        file_url: att.url,
        mime_type: att.mimeType,
        size_bytes: att.size,
        file_type: att.fileType,
        original_name: att.originalName,
        public_id: att.publicId,
        thumbnail_url: att.thumbnail,
        width: att.width,
        height: att.height,
        duration: att.duration
      }));

      const { data, error } = await supabase
        .from('message_attachments')
        .insert(attachmentRecords)
        .select('*');

      if (error) {
        throw new Error(`Failed to insert attachments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('ConversationRepository.insertMessageAttachments error:', error);
      throw error;
    }
  }

  /**
   * Get messages with attachments
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Query options (before, limit, requirementId)
   * @returns {Promise<Array>} Array of messages with attachments
   */
  async listMessagesWithAttachments(conversationId, { before, limit = 50, requirementId = null, aiDesignId = null } = {}) {
    try {
      let query = supabase
        .from('messages')
        .select(`
          *,
          attachments:message_attachments(*)
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) {
        query = query.lt('created_at', before);
      }

      // Filter by requirement_id if provided
      if (requirementId) {
        query = query.eq('requirement_id', requirementId);
      }
      
      // Filter by ai_design_id if provided
      if (aiDesignId) {
        query = query.eq('ai_design_id', aiDesignId);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to list messages with attachments: ${error.message}`);
      }
      // return in ascending chronological order for UI
      return (data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (error) {
      console.error('ConversationRepository.listMessagesWithAttachments error:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read up to a timestamp (or up to a message id)
   */
  async markRead(conversationId, readerUserId, upToIsoTimestamp) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .lt('created_at', upToIsoTimestamp)
        .neq('sender_id', readerUserId)
        .select('id');
      if (error) {
        throw new Error(`Failed to mark messages read: ${error.message}`);
      }
      return Array.isArray(data) ? data.length : 0;
    } catch (error) {
      console.error('ConversationRepository.markRead error:', error);
      throw error;
    }
  }
}

module.exports = new ConversationRepository();

