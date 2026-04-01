const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const notifyAsync = require('../utils/notifyAsync');
const { parsePagination } = require('../utils/paginationHelper');

/**
 * Generate UPI deep link string
 * @param {number} amount - Amount in INR
 * @param {string} responseId - Requirement response ID for transaction note
 * @returns {string} UPI deep link
 */
function generateUpiLink(amount, responseId) {
  const upiVpa = process.env.UPI_VPA || 'groupo@hdfc';
  const upiName = process.env.UPI_DISPLAY_NAME || 'Groupo';
  const transactionNote = `Order ${responseId.slice(0, 8)}`;
  
  return `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;
}

// POST /api/payments/create-qr - Generate QR code for payment (Buyer only)
router.post('/create-qr', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can initiate payments'
      });
    }

    const { requirement_response_id, payment_number } = req.body;

    if (!requirement_response_id) {
      return res.status(400).json({
        success: false,
        message: 'requirement_response_id is required'
      });
    }

    if (!payment_number || ![1, 2].includes(payment_number)) {
      return res.status(400).json({
        success: false,
        message: 'payment_number must be 1 or 2'
      });
    }

    // Get the requirement response
    const response = await databaseService.getRequirementResponseById(requirement_response_id);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Requirement response not found'
      });
    }

    // Verify buyer owns this requirement
    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to pay for this quote'
      });
    }

    // Check if payment already exists for this response + number
    const existingPayment = await databaseService.getPaymentByResponseAndNumber(
      requirement_response_id,
      payment_number
    );

    if (existingPayment) {
      // If payment is already paid, don't allow creating new
      if (existingPayment.status === 'paid') {
        return res.status(400).json({
          success: false,
          message: `Payment ${payment_number} is already completed`,
          data: existingPayment
        });
      }
      
      // If pending_verification, return existing with message
      if (existingPayment.status === 'pending_verification') {
        return res.status(400).json({
          success: false,
          message: `Payment ${payment_number} is already pending verification`,
          data: existingPayment
        });
      }
      
      // If pending or failed, regenerate QR with existing payment record
      if (existingPayment.status === 'pending' || existingPayment.status === 'failed') {
        // Reset to pending if it was failed
        if (existingPayment.status === 'failed') {
          await databaseService.updatePayment(existingPayment.id, {
            status: 'pending',
            utr_number: null,
            notes: 'QR regenerated after failed verification'
          });
        }

        const upiLink = generateUpiLink(existingPayment.amount, requirement_response_id);
        const qrImageDataUrl = await QRCode.toDataURL(upiLink, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });

        return res.status(200).json({
          success: true,
          message: existingPayment.status === 'failed' ? 'Payment QR regenerated' : 'Payment QR retrieved',
          data: {
            payment_id: existingPayment.id,
            qr_image_base64: qrImageDataUrl,
            amount: existingPayment.amount,
            upi_id: process.env.UPI_VPA || 'groupo@hdfc',
            upi_name: process.env.UPI_DISPLAY_NAME || 'Groupo',
            payment_number: existingPayment.payment_number
          }
        });
      }
    }

    // Validate payment sequence
    if (payment_number === 2) {
      const firstPayment = await databaseService.getPaymentByResponseAndNumber(
        requirement_response_id,
        1
      );
      if (!firstPayment || firstPayment.status !== 'paid') {
        return res.status(400).json({
          success: false,
          message: 'First payment must be completed before second payment'
        });
      }
    }

    // Calculate amount: 50% of quoted price for each payment
    const amount = parseFloat(response.quoted_price) * 0.5;

    // Create payment record (with race condition handling)
    const paymentData = {
      requirement_response_id,
      buyer_id: req.user.userId,
      manufacturer_id: response.manufacturer_id,
      payment_number,
      amount,
      status: 'pending'
    };

    let payment;
    try {
      payment = await databaseService.createPayment(paymentData);
    } catch (createError) {
      // Handle race condition: if another request created the payment, fetch and return it
      if (createError.message && createError.message.includes('duplicate key')) {
        const racePayment = await databaseService.getPaymentByResponseAndNumber(
          requirement_response_id,
          payment_number
        );
        
        if (racePayment) {
          const upiLink = generateUpiLink(racePayment.amount, requirement_response_id);
          const qrImageDataUrl = await QRCode.toDataURL(upiLink, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          });

          return res.status(200).json({
            success: true,
            message: 'Payment QR retrieved',
            data: {
              payment_id: racePayment.id,
              qr_image_base64: qrImageDataUrl,
              amount: racePayment.amount,
              upi_id: process.env.UPI_VPA || 'groupo@hdfc',
              upi_name: process.env.UPI_DISPLAY_NAME || 'Groupo',
              payment_number: racePayment.payment_number
            }
          });
        }
      }
      // Re-throw if it's not a duplicate key error
      throw createError;
    }

    // Generate UPI QR code
    const upiLink = generateUpiLink(amount, requirement_response_id);
    const qrImageDataUrl = await QRCode.toDataURL(upiLink, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    return res.status(201).json({
      success: true,
      message: 'Payment QR generated successfully',
      data: {
        payment_id: payment.id,
        qr_image_base64: qrImageDataUrl,
        amount: payment.amount,
        upi_id: process.env.UPI_VPA || 'groupo@hdfc',
        upi_name: process.env.UPI_DISPLAY_NAME || 'Groupo',
        payment_number: payment.payment_number
      }
    });
  } catch (error) {
    console.error('Create payment QR error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate payment QR',
      error: error.message
    });
  }
});

// POST /api/payments/submit-utr - Submit UTR number after payment (Buyer only)
router.post('/submit-utr', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can submit UTR'
      });
    }

    const { payment_id, utr_number } = req.body;

    if (!payment_id) {
      return res.status(400).json({
        success: false,
        message: 'payment_id is required'
      });
    }

    if (!utr_number || typeof utr_number !== 'string' || utr_number.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Valid UTR number is required (minimum 6 characters)'
      });
    }

    const payment = await databaseService.getPaymentById(payment_id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this payment'
      });
    }

    if (payment.status !== 'pending' && payment.status !== 'failed') {
      return res.status(400).json({
        success: false,
        message: `Cannot submit UTR for payment with status: ${payment.status}`
      });
    }

    const updatedPayment = await databaseService.updatePayment(payment_id, {
      utr_number: utr_number.trim().toUpperCase(),
      status: 'pending_verification',
      paid_at: new Date().toISOString()
    });

    // Requirement-level lifecycle is intentionally simple:
    // pending -> accepted on first UTR submit, rejected on buyer rejection only.
    if (updatedPayment.payment_number === 1) {
      const response = await databaseService.getRequirementResponseById(updatedPayment.requirement_response_id);
      if (response?.requirement_id) {
        await databaseService.updateRequirement(response.requirement_id, { status: 'accepted' });
      }
    }

    // Notify admin via socket (if connected)
    const io = req.app.locals.io;
    if (io) {
      io.emit('payment:utr_submitted', {
        payment_id: updatedPayment.id,
        utr_number: updatedPayment.utr_number,
        amount: updatedPayment.amount,
        payment_number: updatedPayment.payment_number
      });
    }

    return res.status(200).json({
      success: true,
      message: 'UTR submitted successfully. Awaiting admin verification.',
      data: {
        payment_id: updatedPayment.id,
        status: updatedPayment.status,
        utr_number: updatedPayment.utr_number
      }
    });
  } catch (error) {
    console.error('Submit UTR error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit UTR',
      error: error.message
    });
  }
});

// GET /api/payments/status/:requirementResponseId - Get payment status for a response
router.get('/status/:requirementResponseId', authenticateToken, async (req, res) => {
  try {
    const { requirementResponseId } = req.params;

    const response = await databaseService.getRequirementResponseById(requirementResponseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Requirement response not found'
      });
    }

    // Verify access
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const isBuyer = req.user.role === 'buyer' && requirement?.buyer_id === req.user.userId;
    const isManufacturer = req.user.role === 'manufacturer' && response.manufacturer_id === req.user.userId;

    if (!isBuyer && !isManufacturer) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view these payments'
      });
    }

    const payments = await databaseService.getPaymentsByResponseId(requirementResponseId);

    return res.status(200).json({
      success: true,
      data: payments,
      count: payments.length
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status',
      error: error.message
    });
  }
});

// GET /api/payments/my-payments - Get all payments for current user
router.get('/my-payments', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const options = {
      status,
      limit,
      offset
    };

    let payments;
    if (req.user.role === 'buyer') {
      payments = await databaseService.getBuyerPayments(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      payments = await databaseService.getManufacturerPayments(req.user.userId, options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    return res.status(200).json({
      success: true,
      data: payments,
      count: payments.length
    });
  } catch (error) {
    console.error('Get my payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payments',
      error: error.message
    });
  }
});

// GET /api/payments/admin/pending - Get all payments pending verification (Admin only)
router.get('/admin/pending', authenticateAdmin, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const options = {
      limit,
      offset
    };

    const payments = await databaseService.getPendingVerificationPayments(options);

    return res.status(200).json({
      success: true,
      data: payments,
      count: payments.length
    });
  } catch (error) {
    console.error('Get pending payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending payments',
      error: error.message
    });
  }
});

// POST /api/payments/verify/:paymentId - Verify or reject a payment (Admin only)
router.post('/verify/:paymentId', authenticateAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { approved, notes } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'approved field is required and must be a boolean'
      });
    }

    const payment = await databaseService.getPaymentWithDetails(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'pending_verification') {
      return res.status(400).json({
        success: false,
        message: `Cannot verify payment with status: ${payment.status}`
      });
    }

    let updatedPayment;
    let newResponseStatus;

    if (approved) {
      // Only store verified_by if it's a valid UUID format
      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.user.userId);
      
      updatedPayment = await databaseService.updatePayment(paymentId, {
        status: 'paid',
        verified_by: isValidUuid ? req.user.userId : null,
        verified_at: new Date().toISOString(),
        notes: notes || (isValidUuid ? null : `Verified by admin: ${req.user.userId}`)
      });

      // Update requirement response status based on payment number
      // For payment 1, keep status as 'accepted' until admin marks M1 as paid
      // For payment 2, set to 'cleared_to_ship' after verification
      if (payment.payment_number === 1) {
        newResponseStatus = 'accepted';
      } else {
        newResponseStatus = 'cleared_to_ship';
      }

      try {
        await databaseService.updateRequirementResponse(payment.requirement_response_id, {
          status: newResponseStatus
        });
      } catch (statusError) {
        console.warn('Could not set status:', statusError.message);
      }

      // Notify admin that payment 1 is verified and ready for manual M1 payout release
      const io = req.app.locals.io;
      if (payment.payment_number === 1 && io) {
        io.emit('payment:verified_admin_action_needed', {
          paymentId: updatedPayment.id,
          payment_number: 1,
          requirementResponseId: payment.requirement_response_id,
          message: 'Payment 1 verified. Please mark M1 payout as paid in Milestones tab.'
        });
      }

      // Notify manufacturer via socket
      if (io) {
        io.to(`user:${payment.manufacturer_id}`).emit('payment:verified', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          amount: updatedPayment.amount,
          response_status: newResponseStatus
        });
      }

      // Notify buyer via socket
      if (io) {
        io.to(`user:${payment.buyer_id}`).emit('payment:verified', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          amount: updatedPayment.amount,
          response_status: newResponseStatus
        });
      }

      // Send WhatsApp notification to manufacturer (fire and forget)
      notifyAsync(async () => {
        const manufacturer = await databaseService.findManufacturerProfile(payment.manufacturer_id);
        if (manufacturer?.phone_number) {
          const requirement = payment.requirement_response?.requirement || {};

          if (payment.payment_number === 2) {
            await whatsappService.notifyRemainingPaymentReceived(manufacturer.phone_number, updatedPayment, requirement);
          } else {
            await whatsappService.notifyPaymentVerified(manufacturer.phone_number, updatedPayment, requirement);
          }
        }
      }, 'WhatsApp notification (payment verified)');
    } else {
      // Only store verified_by if it's a valid UUID format
      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.user.userId);
      const adminNote = isValidUuid ? '' : `Rejected by admin: ${req.user.userId}. `;
      
      updatedPayment = await databaseService.updatePayment(paymentId, {
        status: 'failed',
        verified_by: isValidUuid ? req.user.userId : null,
        verified_at: new Date().toISOString(),
        notes: adminNote + (notes || 'Payment verification failed')
      });

      // Notify buyer to retry
      const io = req.app.locals.io;
      if (io) {
        io.to(`user:${payment.buyer_id}`).emit('payment:rejected', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          reason: notes || 'Payment verification failed. Please retry.'
        });
      }

      // Send WhatsApp notification to buyer (fire and forget)
      notifyAsync(async () => {
        const buyer = await databaseService.findBuyerProfile(payment.buyer_id);
        if (buyer?.phone_number) {
          await whatsappService.notifyPaymentRejected(buyer.phone_number, updatedPayment, notes);
        }
      }, 'WhatsApp notification (payment rejected)');
    }

    return res.status(200).json({
      success: true,
      message: approved ? 'Payment verified successfully' : 'Payment rejected',
      data: {
        payment_id: updatedPayment.id,
        status: updatedPayment.status,
        response_status: newResponseStatus || null
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
});

// POST /api/payments/refund/:paymentId - Refund a payment (Admin only)
router.post('/refund/:paymentId', authenticateAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Refund reason is required (minimum 5 characters)'
      });
    }

    const payment = await databaseService.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `Cannot refund payment with status: ${payment.status}`
      });
    }

    const updatedPayment = await databaseService.updatePayment(paymentId, {
      status: 'refunded',
      refund_reason: reason.trim(),
      refunded_at: new Date().toISOString()
    });

    // Notify buyer
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${payment.buyer_id}`).emit('payment:refunded', {
        payment_id: updatedPayment.id,
        amount: updatedPayment.amount,
        reason: reason.trim()
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment refunded successfully',
      data: updatedPayment
    });
  } catch (error) {
    console.error('Refund payment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refund payment',
      error: error.message
    });
  }
});

module.exports = router;
