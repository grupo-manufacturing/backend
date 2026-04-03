const axios = require('axios');

const API_BASE_URL = 'https://wasenderapi.com/api';
const API_ENDPOINTS = {
  ON_WHATSAPP: '/on-whatsapp',
  SEND_MESSAGE: '/send-message',
  USER: '/user'
};
const PORTAL_URLS = {
  MANUFACTURER: 'https://grupo.in/manufacturer-portal',
  BUYER: 'https://grupo.in/buyer-portal'
};

class WhatsAppService {
  constructor() {
    this.apiKey = process.env.WASENDER_API_KEY;
    this.enabled = !!this.apiKey;
    this.client = this.enabled
      ? axios.create({
          baseURL: API_BASE_URL,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 30000
        })
      : null;
    
    if (!this.enabled) {
      console.warn('[WhatsAppService] WASENDER_API_KEY not configured. WhatsApp notifications disabled.');
    }
  }

  buildError(message, code = 'WHATSAPP_ERROR') {
    return { success: false, error: { code, message } };
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
      return { exists: false, error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp service not configured' } };
    }

    try {
      const jid = this.formatToJid(phoneNumber);
      const response = await this.client.get(`${API_ENDPOINTS.ON_WHATSAPP}/${jid}`);
      
      return {
        exists: response.data?.exists === true || response.data?.onWhatsApp === true,
        jid: jid
      };
    } catch (error) {
      console.error('[WhatsAppService] Error checking WhatsApp status:', error.message);
      return { exists: false, error: { code: 'WHATSAPP_STATUS_CHECK_FAILED', message: error.message } };
    }
  }

  /**
   * Send a text message via WhatsApp
   * @param {string} phoneNumber - Recipient phone number in E.164 format
   * @param {string} message - Message text to send
   * @returns {Promise<{success: boolean, messageId?: string, error?: {code: string, message: string}}>}
   */
  async sendMessage(phoneNumber, message) {
    if (!this.enabled) {
      console.warn('[WhatsAppService] Service not enabled. Message not sent.');
      return this.buildError('WhatsApp service not configured', 'WHATSAPP_NOT_CONFIGURED');
    }

    if (!phoneNumber || !message) {
      return this.buildError('Phone number and message are required', 'WHATSAPP_INVALID_INPUT');
    }

    try {
      const to = this.formatPhoneNumber(phoneNumber);
      
      const response = await this.client.post(API_ENDPOINTS.SEND_MESSAGE, {
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
      
      return this.buildError(errorMessage, 'WHATSAPP_SEND_FAILED');
    }
  }

  /**
   * Get session user info (verify API connection)
   * @returns {Promise<{success: boolean, user?: object, error?: {code: string, message: string}}>}
   */
  async getSessionInfo() {
    if (!this.enabled) {
      return this.buildError('WhatsApp service not configured', 'WHATSAPP_NOT_CONFIGURED');
    }

    try {
      const response = await this.client.get(API_ENDPOINTS.USER);
      
      return {
        success: true,
        user: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error('[WhatsAppService] Error getting session info:', errorMessage);
      
      return this.buildError(errorMessage, 'WHATSAPP_SESSION_INFO_FAILED');
    }
  }

  // ========================================
  // Notification Helper Methods
  // ========================================

  /**
   * Send notification for new requirement (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyNewRequirement(phoneNumber, requirement) {
    const message = `🔔 *New Requirement on Grupo!*

A buyer is looking for:
${requirement.quantity ? `📊 Quantity: ${requirement.quantity.toLocaleString()}` : ''}
${requirement.product_type ? `🏷️ Type: ${requirement.product_type}` : ''}

Login to your Grupo manufacturer portal to submit a quote!
${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for new requirement response (to buyers)
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} response - Response details
   * @param {object} manufacturer - Manufacturer details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyNewRequirementResponse(phoneNumber, response, manufacturer) {
    const message = `🎉 *New Quote Received on Grupo!*

${manufacturer?.unit_name || 'A manufacturer'} has responded to your requirement!

Login to your Grupo buyer portal to review and respond!
${PORTAL_URLS.BUYER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for requirement response status update (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} status - New status (accepted, rejected)
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyResponseStatusUpdate(phoneNumber, status, requirement) {
    const statusEmoji = status === 'accepted' ? '✅' : status === 'rejected' ? '❌' : '💬';
    const statusText = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : String(status);
    
    const requirementIdentifier = requirement?.requirement_no || requirement?.id || 'the requirement';
    
    const message = `${statusEmoji} *Response ${statusText}!*

Your response for requirement ${requirementIdentifier} has been ${statusText}.

Login to your Grupo manufacturer portal for more details!
${PORTAL_URLS.MANUFACTURER}`;

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
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyPaymentVerified(phoneNumber, payment, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'your order';
    const isFirstPayment = payment?.payment_number === 1;

    const paymentReferenceLine = payment?.utr_number
      ? `\n\nPayment Reference : ${payment.utr_number}`
      : '';
    
    const message = isFirstPayment
      ? `💰 *Payment Received !*

Amount Received (50% advance) has been verified for requirement ${requirementId}.

✅ Please wait for the M1 Payout to be transferred before starting production.

Login to your Grupo manufacturer portal to update milestones.
${PORTAL_URLS.MANUFACTURER}`
      : `💰 *Final Payment Received - Ship Now!*

Amount Received (remaining 50%) has been verified for requirement ${requirementId}.

📦 Please ship the order and share tracking details with the buyer.
${paymentReferenceLine}

${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify buyer that their payment verification failed and they need to retry
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} payment - Payment details
   * @param {string} reason - Rejection reason
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyPaymentRejected(phoneNumber, payment, reason) {
    const paymentReferenceLine = payment?.utr_number
      ? `\n\nPayment Reference : ${payment.utr_number}`
      : '';

    const message = `❌ *Payment Verification Failed*

We could not verify the UTR for your submitted payment.

${reason ? `Reason: ${reason}` : ''}

Please retry the payment with the correct UTR number.
${paymentReferenceLine}

${PORTAL_URLS.BUYER}`;

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
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyMilestonePendingApproval(phoneNumber, milestone, requirement, manufacturer) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'your order';
    const manufacturerName = manufacturer?.unit_name || 'The manufacturer';
    
    const milestoneLabel = milestone === 'm1' ? 'M1' : 'M2';
    
    const message = `📦 *${milestoneLabel} Ready for Review!*

${manufacturerName} has marked ${milestoneLabel} as complete for requirement ${requirementId}.

Please review the samples/progress in your chat and approve to release the milestone payment.

${PORTAL_URLS.BUYER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that buyer approved their milestone
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} milestone - 'm1' or 'm2'
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyMilestoneApproved(phoneNumber, milestone, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    const milestoneLabel = milestone === 'm1' ? 'M1' : 'M2';
    
    const message = `✅ *${milestoneLabel} Approved!*

The buyer has approved ${milestoneLabel} for requirement ${requirementId}.

We'll notify you about the shipping once the buyer pays the remaining 50%.

${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that milestone payout has been transferred
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} milestone - 'm1' or 'm2'
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyMilestonePayoutCompleted(phoneNumber, milestone, requirement, transactionRef) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';

    const milestoneLabel = milestone === 'm1' ? 'M1' : 'M2';
    
    const nextStepMessage = milestone === 'm1'
      ? '\n\n🚀 You can now proceed with sample production. Update progress in your portal.'
      : '\n\n📦 You can now proceed with full production. Update progress in your portal.';
    
    const paymentReferenceLine = transactionRef
      ? `\n\nPayment Reference : ${transactionRef}`
      : '';

    const message = `💰 *${milestoneLabel} Payout Transferred!*

Payout transferred (25% milestone) for requirement ${requirementId}.${nextStepMessage}

${paymentReferenceLine}

${PORTAL_URLS.MANUFACTURER}`;

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
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
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

Great news! Requirement ${requirementId} has been dispatched by the manufacturer.

${trackingInfo}

${PORTAL_URLS.BUYER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that remaining payment has been received (ready to ship)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} payment - Payment details
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyRemainingPaymentReceived(phoneNumber, payment, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    // Intentionally not displaying rupee amounts in WhatsApp notifications.

    const paymentReferenceLine = payment?.utr_number
      ? `\n\nPayment Reference : ${payment.utr_number}`
      : '';

    const message = `💰 *Remaining Payment Received - Ship Now!*

Amount Received (remaining 50%) has been verified for requirement ${requirementId}.

📦 Please ship the order to the buyer.

${paymentReferenceLine}

${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

  // ========================================
  // Delivery & Completion Notification Methods
  // ========================================

  /**
   * Notify manufacturer that buyer confirmed delivery
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyDeliveryConfirmed(phoneNumber, requirement) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';
    
    const message = `✅ *Delivery Confirmed!*

The buyer has confirmed receiving requirement ${requirementId}.

The admin will process the final payout shortly. You'll be notified once the payment is transferred.

${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Notify manufacturer that final payout has been transferred and order is complete
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: {code: string, message: string}}>}
   */
  async notifyFinalPayoutCompleted(phoneNumber, requirement, transactionRef) {
    const requirementId = requirement?.requirement_no || requirement?.id || 'the order';

    const paymentReferenceLine = transactionRef
      ? `\n\nPayment Reference : ${transactionRef}`
      : '';
    
    const message = `🎉 *Order Completed - Final Payout Transferred!*

Final payout transferred (final 50%) for requirement ${requirementId}.

Thank you for a successful order!

${paymentReferenceLine}

${PORTAL_URLS.MANUFACTURER}`;

    return this.sendMessage(phoneNumber, message);
  }

}

// Export singleton instance
module.exports = new WhatsAppService();

