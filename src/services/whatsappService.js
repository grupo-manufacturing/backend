const axios = require('axios');

const API_BASE = 'https://wasenderapi.com/api';
const PORTAL = {
  MANUFACTURER: 'https://grupo.in/manufacturer-portal',
  BUYER: 'https://grupo.in/buyer-portal'
};

class WhatsAppService {
  constructor() {
    this.apiKey = process.env.WASENDER_API_KEY;
    this.enabled = !!this.apiKey;
    this.client = this.enabled
      ? axios.create({
          baseURL: API_BASE,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 30000
        })
      : null;

    if (!this.enabled) {
      console.warn('[WhatsAppService] WASENDER_API_KEY not set. Notifications disabled.');
    }
  }

  buildError(message, code = 'WHATSAPP_ERROR') {
    return { success: false, error: { code, message } };
  }

  formatToJid(phoneNumber) {
    return `${phoneNumber.replace(/[\+\s\-\(\)]/g, '')}@s.whatsapp.net`;
  }

  formatPhoneNumber(phoneNumber) {
    return phoneNumber.replace(/[\+\s\-\(\)]/g, '');
  }

  async isOnWhatsApp(phoneNumber) {
    if (!this.enabled) return { exists: false, error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp service not configured' } };
    try {
      const jid = this.formatToJid(phoneNumber);
      const response = await this.client.get(`/on-whatsapp/${jid}`);
      return { exists: response.data?.exists === true || response.data?.onWhatsApp === true, jid };
    } catch (error) {
      return { exists: false, error: { code: 'WHATSAPP_STATUS_CHECK_FAILED', message: error.message } };
    }
  }

  async sendMessage(phoneNumber, message) {
    if (!this.enabled) return this.buildError('WhatsApp service not configured', 'WHATSAPP_NOT_CONFIGURED');
    if (!phoneNumber || !message) return this.buildError('Phone number and message are required', 'WHATSAPP_INVALID_INPUT');

    try {
      const response = await this.client.post('/send-message', {
        to: this.formatPhoneNumber(phoneNumber),
        text: message
      });
      return { success: true, messageId: response.data?.messageId || response.data?.id || null };
    } catch (error) {
      return this.buildError(error.response?.data?.message || error.message, 'WHATSAPP_SEND_FAILED');
    }
  }

  async getSessionInfo() {
    if (!this.enabled) return this.buildError('WhatsApp service not configured', 'WHATSAPP_NOT_CONFIGURED');
    try {
      const response = await this.client.get('/user');
      return { success: true, user: response.data };
    } catch (error) {
      return this.buildError(error.response?.data?.message || error.message, 'WHATSAPP_SESSION_INFO_FAILED');
    }
  }

  async notifyNewRequirement(phoneNumber, requirement) {
    return this.sendMessage(phoneNumber, `🔔 *New Requirement on Grupo!*

A buyer is looking for:
${requirement.quantity ? `📊 Quantity: ${requirement.quantity.toLocaleString()}` : ''}
${requirement.product_type ? `🏷️ Type: ${requirement.product_type}` : ''}

Login to submit a quote!
${PORTAL.MANUFACTURER}`);
  }

  async notifyNewRequirementResponse(phoneNumber, response, manufacturer) {
    return this.sendMessage(phoneNumber, `🎉 *New Quote Received on Grupo!*

${manufacturer?.unit_name || 'A manufacturer'} has responded to your requirement!

${PORTAL.BUYER}`);
  }

  async notifyResponseStatusUpdate(phoneNumber, status, requirement) {
    const emoji = status === 'accepted' ? '✅' : '❌';
    const label = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : String(status);
    const id = requirement?.requirement_no || requirement?.id || 'the requirement';

    return this.sendMessage(phoneNumber, `${emoji} *Response ${label}!*

Your response for requirement ${id} has been ${label}.

${PORTAL.MANUFACTURER}`);
  }

  async notifyPaymentVerified(phoneNumber, payment, requirement) {
    const id = requirement?.requirement_no || requirement?.id || 'your order';
    const isFirst = payment?.payment_number === 1;
    const ref = payment?.utr_number ? `\n\nPayment Reference : ${payment.utr_number}` : '';

    return this.sendMessage(phoneNumber, isFirst
      ? `💰 *Payment Received!*

Amount Received (50% advance) verified for requirement ${id}.

✅ Please wait for the M1 Payout before starting production.

${PORTAL.MANUFACTURER}`
      : `💰 *Final Payment Received - Ship Now!*

Amount Received (remaining 50%) verified for requirement ${id}.

📦 Please ship the order and share tracking details.
${ref}

${PORTAL.MANUFACTURER}`);
  }

  async notifyPaymentRejected(phoneNumber, payment, reason) {
    const ref = payment?.utr_number ? `\n\nPayment Reference : ${payment.utr_number}` : '';
    return this.sendMessage(phoneNumber, `❌ *Payment Verification Failed*

${reason ? `Reason: ${reason}` : ''}

Please retry with the correct UTR number.
${ref}

${PORTAL.BUYER}`);
  }

  async notifyMilestonePendingApproval(phoneNumber, milestone, requirement, manufacturer) {
    const id = requirement?.requirement_no || requirement?.id || 'your order';
    const label = milestone === 'm1' ? 'M1' : 'M2';
    const mfr = manufacturer?.unit_name || 'The manufacturer';

    return this.sendMessage(phoneNumber, `📦 *${label} Ready for Review!*

${mfr} has marked ${label} as complete for requirement ${id}.

Please review and approve to release the milestone payment.

${PORTAL.BUYER}`);
  }

  async notifyMilestoneApproved(phoneNumber, milestone, requirement) {
    const id = requirement?.requirement_no || requirement?.id || 'the order';
    const label = milestone === 'm1' ? 'M1' : 'M2';

    return this.sendMessage(phoneNumber, `✅ *${label} Approved!*

The buyer has approved ${label} for requirement ${id}.

${PORTAL.MANUFACTURER}`);
  }

  async notifyMilestonePayoutCompleted(phoneNumber, milestone, requirement, transactionRef) {
    const id = requirement?.requirement_no || requirement?.id || 'the order';
    const label = milestone === 'm1' ? 'M1' : 'M2';
    const next = milestone === 'm1'
      ? '\n\n🚀 You can now proceed with sample production.'
      : '\n\n📦 You can now proceed with full production.';
    const ref = transactionRef ? `\n\nPayment Reference : ${transactionRef}` : '';

    return this.sendMessage(phoneNumber, `💰 *${label} Payout Transferred!*

Payout transferred for requirement ${id}.${next}
${ref}

${PORTAL.MANUFACTURER}`);
  }

  async notifyOrderShipped(phoneNumber, requirement, trackingNumber, shippingProvider) {
    const id = requirement?.requirement_no || requirement?.id || 'your order';
    let tracking = '';
    if (trackingNumber || shippingProvider) {
      tracking = '\n\n📋 Tracking Details:';
      if (shippingProvider) tracking += `\nProvider: ${shippingProvider}`;
      if (trackingNumber) tracking += `\nTracking #: ${trackingNumber}`;
    }

    return this.sendMessage(phoneNumber, `📦 *Your Order Has Been Shipped!*

Requirement ${id} has been dispatched.
${tracking}

${PORTAL.BUYER}`);
  }

  async notifyRemainingPaymentReceived(phoneNumber, payment, requirement) {
    const id = requirement?.requirement_no || requirement?.id || 'the order';
    const ref = payment?.utr_number ? `\n\nPayment Reference : ${payment.utr_number}` : '';

    return this.sendMessage(phoneNumber, `💰 *Remaining Payment Received - Ship Now!*

Amount Received (remaining 50%) verified for requirement ${id}.

📦 Please ship the order to the buyer.
${ref}

${PORTAL.MANUFACTURER}`);
  }

  async notifyDeliveryConfirmed(phoneNumber, requirement) {
    const id = requirement?.requirement_no || requirement?.id || 'the order';
    return this.sendMessage(phoneNumber, `✅ *Delivery Confirmed!*

The buyer has confirmed receiving requirement ${id}.

The admin will process the final payout shortly.

${PORTAL.MANUFACTURER}`);
  }

  async notifyFinalPayoutCompleted(phoneNumber, requirement, transactionRef) {
    const id = requirement?.requirement_no || requirement?.id || 'the order';
    const ref = transactionRef ? `\n\nPayment Reference : ${transactionRef}` : '';

    return this.sendMessage(phoneNumber, `🎉 *Order Completed - Final Payout Transferred!*

Final payout transferred for requirement ${id}.

Thank you for a successful order!
${ref}

${PORTAL.MANUFACTURER}`);
  }
}

module.exports = new WhatsAppService();