const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.baseUrl = 'https://wasenderapi.com/api';
    this.apiKey = process.env.WASENDER_API_KEY;
    this.enabled = !!this.apiKey;
    
    if (!this.enabled) {
      console.warn('[WhatsAppService] WASENDER_API_KEY not configured. WhatsApp notifications disabled.');
    }
  }

  /**
   * Get axios instance with auth headers
   * @returns {import('axios').AxiosInstance}
   */
  getClient() {
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
  }

  /**
   * Format phone number to JID format (WhatsApp ID)
   * @param {string} phoneNumber - Phone number in E.164 format (e.g., +919876543210)
   * @returns {string} JID format (e.g., 919876543210@s.whatsapp.net)
   */
  formatToJid(phoneNumber) {
    // Remove + and any spaces/dashes
    const cleaned = phoneNumber.replace(/[\+\s\-\(\)]/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Format phone number for API (without @s.whatsapp.net)
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {string} Cleaned phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove + and any spaces/dashes
    return phoneNumber.replace(/[\+\s\-\(\)]/g, '');
  }

  /**
   * Check if a phone number is registered on WhatsApp
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {Promise<{exists: boolean, jid?: string}>}
   */
  async isOnWhatsApp(phoneNumber) {
    if (!this.enabled) {
      console.warn('[WhatsAppService] Service not enabled');
      return { exists: false };
    }

    try {
      const jid = this.formatToJid(phoneNumber);
      const client = this.getClient();
      const response = await client.get(`/on-whatsapp/${jid}`);
      
      return {
        exists: response.data?.exists === true || response.data?.onWhatsApp === true,
        jid: jid
      };
    } catch (error) {
      console.error('[WhatsAppService] Error checking WhatsApp status:', error.message);
      return { exists: false };
    }
  }

  /**
   * Send a text message via WhatsApp
   * @param {string} phoneNumber - Recipient phone number in E.164 format
   * @param {string} message - Message text to send
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMessage(phoneNumber, message) {
    if (!this.enabled) {
      console.warn('[WhatsAppService] Service not enabled. Message not sent.');
      return { success: false, error: 'WhatsApp service not configured' };
    }

    if (!phoneNumber || !message) {
      return { success: false, error: 'Phone number and message are required' };
    }

    try {
      const client = this.getClient();
      const to = this.formatPhoneNumber(phoneNumber);
      
      const response = await client.post('/send-message', {
        to: to,
        text: message
      });

      console.log(`[WhatsAppService] Message sent to ${phoneNumber}`);
      
      return {
        success: true,
        messageId: response.data?.messageId || response.data?.id || null
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error('[WhatsAppService] Error sending message:', errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get session user info (verify API connection)
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  async getSessionInfo() {
    if (!this.enabled) {
      return { success: false, error: 'WhatsApp service not configured' };
    }

    try {
      const client = this.getClient();
      const response = await client.get('/user');
      
      return {
        success: true,
        user: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error('[WhatsAppService] Error getting session info:', errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // ========================================
  // Notification Helper Methods
  // ========================================

  /**
   * Send notification for new requirement (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewRequirement(phoneNumber, requirement) {
    const message = `🔔 *New Requirement on Grupo!*

A buyer is looking for:
${requirement.quantity ? `📊 Quantity: ${requirement.quantity.toLocaleString()}` : ''}
${requirement.product_type ? `🏷️ Type: ${requirement.product_type}` : ''}

Login to your Grupo manufacturer portal to submit a quote!
https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for new requirement response (to buyers)
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} response - Response details
   * @param {object} manufacturer - Manufacturer details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewRequirementResponse(phoneNumber, response, manufacturer) {
    const message = `🎉 *New Quote Received on Grupo!*

${manufacturer?.unit_name || 'A manufacturer'} has responded to your requirement!

Login to your Grupo buyer portal to review and respond!
https://grupo.in/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for requirement response status update (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} status - New status (accepted, rejected)
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyResponseStatusUpdate(phoneNumber, status, requirement) {
    const statusEmoji = status === 'accepted' ? '✅' : status === 'rejected' ? '❌' : '💬';
    const statusText = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : String(status);
    
    const requirementIdentifier = requirement?.requirement_no || requirement?.id || 'the requirement';
    
    const message = `${statusEmoji} *Quote ${statusText}!*

Your quote for requirement ${requirementIdentifier} has been ${status}.

${status === 'accepted' ? 'Congratulations! The buyer has accepted your quote. You can now start chatting to finalize details.' : ''}

Login to your Grupo manufacturer portal for more details!
https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  // ========================================
  // Payment Notification Methods
  // ========================================

  /**
   * Notify manufacturer that payment has been verified and they can start production
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} payment - Payment details
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyPaymentVerified(phoneNumber, payment, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'your order';
    const amountFormatted = payment?.amount 
      ? `₹${Number(payment.amount).toLocaleString('en-IN')}` 
      : 'the payment';

    const isFirstPayment = payment?.payment_number === 1;
    
    const message = isFirstPayment
      ? `💰 *Payment Received - Start Production!*

${amountFormatted} (50% advance) has been verified for requirement ${requirementId}.

✅ You may now begin production!

Login to your Grupo manufacturer portal to update milestones.
https://grupo.in/manufacturer-portal`
      : `💰 *Final Payment Received - Ship Now!*

${amountFormatted} (remaining 50%) has been verified for requirement ${requirementId}.

📦 Please ship the order and share tracking details with the buyer.

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify buyer that their payment verification failed and they need to retry
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} payment - Payment details
   * @param {string} reason - Rejection reason
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyPaymentRejected(phoneNumber, payment, reason) {
    const amountFormatted = payment?.amount 
      ? `₹${Number(payment.amount).toLocaleString('en-IN')}` 
      : 'your payment';

    const message = `❌ *Payment Verification Failed*

We could not verify the UTR for ${amountFormatted}.

${reason ? `Reason: ${reason}` : ''}

Please retry the payment with the correct UTR number.

https://grupo.in/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  // ========================================
  // Milestone Notification Methods
  // ========================================

  /**
   * Notify buyer that a milestone is pending their approval
   * @param {string} phoneNumber - Buyer phone number
   * @param {string} milestone - 'm1' or 'm2'
   * @param {object} requirement - Requirement details
   * @param {object} manufacturer - Manufacturer details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyMilestonePendingApproval(phoneNumber, milestone, requirement, manufacturer) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'your order';
    const manufacturerName = manufacturer?.unit_name || 'The manufacturer';
    
    const milestoneLabel = milestone === 'm1' ? 'Sample/M1' : 'Production/M2';
    
    const message = `📦 *${milestoneLabel} Ready for Review!*

${manufacturerName} has marked ${milestoneLabel} as complete for requirement ${requirementId}.

Please review the samples/progress in your chat and approve to release the milestone payment.

https://grupo.in/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that buyer approved their milestone
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} milestone - 'm1' or 'm2'
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyMilestoneApproved(phoneNumber, milestone, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    const milestoneLabel = milestone === 'm1' ? 'M1 (Sample)' : 'M2 (Production)';
    
    const message = `✅ *${milestoneLabel} Approved!*

The buyer has approved ${milestoneLabel} for requirement ${requirementId}.

The admin will process the 25% milestone payout shortly. You'll be notified once the payment is transferred.

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that milestone payout has been transferred
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} milestone - 'm1' or 'm2'
   * @param {number} payoutAmount - Amount transferred
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyMilestonePayoutCompleted(phoneNumber, milestone, payoutAmount, requirement, transactionRef) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    const amountFormatted = payoutAmount 
      ? `₹${Number(payoutAmount).toLocaleString('en-IN')}` 
      : 'the milestone payment';
    const milestoneLabel = milestone === 'm1' ? 'M1' : 'M2';
    
    const nextStepMessage = milestone === 'm1'
      ? '\n\n🚀 You can now proceed with M2 (full production). Update progress in your portal.'
      : '\n\n📦 Production complete! Await final payment and prepare for shipping.';
    
    const paymentReferenceLine = transactionRef
      ? `\n\nPayment Reference : ${transactionRef}`
      : '';

    const message = `💰 *${milestoneLabel} Payout Transferred!*

${amountFormatted} (25% milestone) has been transferred for requirement ${requirementId}.${nextStepMessage}

${paymentReferenceLine}

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  // ========================================
  // Shipping Notification Methods
  // ========================================

  /**
   * Notify buyer that their order has been shipped
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} requirement - Requirement details
   * @param {string} trackingNumber - Optional tracking number
   * @param {string} shippingProvider - Optional shipping provider
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyOrderShipped(phoneNumber, requirement, trackingNumber, shippingProvider) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'your order';
    
    let trackingInfo = '';
    if (trackingNumber || shippingProvider) {
      trackingInfo = '\n\n📋 Tracking Details:';
      if (shippingProvider) trackingInfo += `\nProvider: ${shippingProvider}`;
      if (trackingNumber) trackingInfo += `\nTracking #: ${trackingNumber}`;
    }
    
    const message = `📦 *Your Order Has Been Shipped!*

Great news! Requirement ${requirementId} has been dispatched by the manufacturer.${trackingInfo}

Check the chat for more details or tracking updates.

https://grupo.in/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that remaining payment has been received (ready to ship)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} payment - Payment details
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyRemainingPaymentReceived(phoneNumber, payment, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    const amountFormatted = payment?.amount 
      ? `₹${Number(payment.amount).toLocaleString('en-IN')}` 
      : 'the remaining payment';

    const message = `💰 *Remaining Payment Received - Ship Now!*

${amountFormatted} (remaining 50%) has been verified for requirement ${requirementId}.

📦 Please ship the order to the buyer and share tracking details in your chat.

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  // ========================================
  // Delivery & Completion Notification Methods
  // ========================================

  /**
   * Notify manufacturer that buyer confirmed delivery
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyDeliveryConfirmed(phoneNumber, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    
    const message = `✅ *Delivery Confirmed!*

The buyer has confirmed receiving requirement ${requirementId}.

The admin will process the final 50% payout shortly. You'll be notified once the payment is transferred.

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that final payout has been transferred and order is complete
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {number} payoutAmount - Final payout amount
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyFinalPayoutCompleted(phoneNumber, payoutAmount, requirement, transactionRef) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    const amountFormatted = payoutAmount 
      ? `₹${Number(payoutAmount).toLocaleString('en-IN')}` 
      : 'the final payment';

    const paymentReferenceLine = transactionRef
      ? `\n\nPayment Reference : ${transactionRef}`
      : '';
    
    const message = `🎉 *Order Completed - Final Payout Transferred!*

${amountFormatted} (final 50%) has been transferred for requirement ${requirementId}.

Thank you for a successful order! The full payment cycle is now complete.

${paymentReferenceLine}

https://grupo.in/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

}

// Export singleton instance
module.exports = new WhatsAppService();

