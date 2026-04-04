const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { ok, fail } = require('../utils/response');
const { parsePagination } = require('../utils/paginationHelper');
const { generateQrImageBase64, buildQrResponseData } = require('../utils/paymentQrHelper');
const { isUuidV4 } = require('../utils/uuidHelper');
const notifyAsync = require('../utils/notifyAsync');

const createQr = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can initiate payments', 403);

    const { requirement_response_id, payment_number } = req.body;

    if (!requirement_response_id) return fail(res, 'requirement_response_id is required');
    if (!payment_number || ![1, 2].includes(payment_number)) return fail(res, 'payment_number must be 1 or 2');

    const responseWithRequirement = await databaseService.getRequirementResponseWithRequirement(requirement_response_id);
    if (!responseWithRequirement) return fail(res, 'Requirement response not found', 404);

    const requirement = responseWithRequirement.requirement;
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to pay for this quote', 403);
    }

    const existingPayment = await databaseService.getPaymentByResponseAndNumber(requirement_response_id, payment_number);

    if (existingPayment) {
      if (existingPayment.status === 'paid') {
        return fail(res, `Payment ${payment_number} is already completed`, 400, { data: existingPayment });
      }
      if (existingPayment.status === 'pending_verification') {
        return fail(res, `Payment ${payment_number} is already pending verification`, 400, { data: existingPayment });
      }
      if (existingPayment.status === 'failed') {
        await databaseService.updatePayment(existingPayment.id, {
          status: 'pending', utr_number: null, notes: 'QR regenerated after failed verification'
        });
      }
      const qrImageDataUrl = await generateQrImageBase64(existingPayment.amount, requirement_response_id);
      return ok(res, {
        message: existingPayment.status === 'failed' ? 'Payment QR regenerated' : 'Payment QR retrieved',
        data: buildQrResponseData(existingPayment, qrImageDataUrl)
      });
    }

    if (payment_number === 2) {
      const firstPayment = await databaseService.getPaymentByResponseAndNumber(requirement_response_id, 1);
      if (!firstPayment || firstPayment.status !== 'paid') {
        return fail(res, 'First payment must be completed before second payment');
      }
    }

    const amount = parseFloat(responseWithRequirement.quoted_price) * 0.5;
    const paymentData = {
      requirement_response_id,
      buyer_id: req.user.userId,
      manufacturer_id: responseWithRequirement.manufacturer_id,
      payment_number,
      amount,
      status: 'pending'
    };

    let payment;
    try {
      payment = await databaseService.createPayment(paymentData);
    } catch (createError) {
      if (createError.message?.includes('duplicate key')) {
        const racePayment = await databaseService.getPaymentByResponseAndNumber(requirement_response_id, payment_number);
        if (racePayment) {
          const qrImageDataUrl = await generateQrImageBase64(racePayment.amount, requirement_response_id);
          return ok(res, { message: 'Payment QR retrieved', data: buildQrResponseData(racePayment, qrImageDataUrl) });
        }
      }
      throw createError;
    }

    const qrImageDataUrl = await generateQrImageBase64(amount, requirement_response_id);
    ok(res, { message: 'Payment QR generated successfully', data: buildQrResponseData(payment, qrImageDataUrl) }, 201);
  } catch (err) {
    fail(res, 'Failed to generate payment QR', 500);
  }
};

const submitUtr = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can submit UTR', 403);

    const { payment_id, utr_number } = req.body;
    if (!payment_id) return fail(res, 'payment_id is required');
    if (!utr_number || typeof utr_number !== 'string' || utr_number.trim().length < 6) {
      return fail(res, 'Valid UTR number is required (minimum 6 characters)');
    }

    const payment = await databaseService.getPaymentById(payment_id);
    if (!payment) return fail(res, 'Payment not found', 404);
    if (payment.buyer_id !== req.user.userId) return fail(res, 'You do not have permission to update this payment', 403);
    if (payment.status !== 'pending' && payment.status !== 'failed') {
      return fail(res, `Cannot submit UTR for payment with status: ${payment.status}`);
    }

    const previousStatus = payment.status;
    const updated = await databaseService.updatePayment(payment_id, {
      utr_number: utr_number.trim().toUpperCase(),
      status: 'pending_verification',
      paid_at: new Date().toISOString()
    });

    if (updated.payment_number === 1 && previousStatus === 'pending') {
      const response = await databaseService.getRequirementResponseById(updated.requirement_response_id);
      if (response?.requirement_id) {
        await databaseService.updateRequirement(response.requirement_id, { status: 'accepted' });
      }
    }

    const io = req.app.locals.io;
    if (io) {
      io.emit('payment:utr_submitted', {
        payment_id: updated.id,
        utr_number: updated.utr_number,
        amount: updated.amount,
        payment_number: updated.payment_number
      });
    }

    ok(res, {
      message: 'UTR submitted successfully. Awaiting admin verification.',
      data: { payment_id: updated.id, status: updated.status, utr_number: updated.utr_number }
    });
  } catch (err) {
    fail(res, 'Failed to submit UTR', 500);
  }
};

const getStatus = async (req, res) => {
  try {
    const { requirementResponseId } = req.params;

    const response = await databaseService.getRequirementResponseById(requirementResponseId);
    if (!response) return fail(res, 'Requirement response not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);
    const isBuyer = req.user.role === 'buyer' && requirement?.buyer_id === req.user.userId;
    const isManufacturer = req.user.role === 'manufacturer' && response.manufacturer_id === req.user.userId;

    if (!isBuyer && !isManufacturer) return fail(res, 'You do not have permission to view these payments', 403);

    const payments = await databaseService.getPaymentsByResponseId(requirementResponseId);
    ok(res, { data: payments, count: payments.length });
  } catch (err) {
    fail(res, 'Failed to fetch payment status', 500);
  }
};

const getMyPayments = async (req, res) => {
  try {
    const { status } = req.query;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const options = { status, limit, offset };

    let payments;
    if (req.user.role === 'buyer') {
      payments = await databaseService.getBuyerPayments(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      payments = await databaseService.getManufacturerPayments(req.user.userId, options);
    } else {
      return fail(res, 'Invalid user role', 403);
    }

    ok(res, { data: payments, count: payments.length });
  } catch (err) {
    fail(res, 'Failed to fetch payments', 500);
  }
};

const getPendingAdmin = async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const payments = await databaseService.getPendingVerificationPayments({ limit, offset });
    ok(res, { data: payments, count: payments.length });
  } catch (err) {
    fail(res, 'Failed to fetch pending payments', 500);
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { approved, notes } = req.body;

    if (typeof approved !== 'boolean') return fail(res, 'approved field is required and must be a boolean');

    const payment = await databaseService.getPaymentWithDetails(paymentId);
    if (!payment) return fail(res, 'Payment not found', 404);
    if (payment.status !== 'pending_verification') return fail(res, `Cannot verify payment with status: ${payment.status}`);

    const isValidUuid = isUuidV4(req.user.userId);
    const io = req.app.locals.io;
    let updatedPayment;
    let newResponseStatus;

    if (approved) {
      updatedPayment = await databaseService.updatePayment(paymentId, {
        status: 'paid',
        verified_by: isValidUuid ? req.user.userId : null,
        verified_at: new Date().toISOString(),
        notes: notes || (isValidUuid ? null : `Verified by admin: ${req.user.userId}`)
      });

      newResponseStatus = payment.payment_number === 1 ? 'accepted' : 'cleared_to_ship';

      try {
        await databaseService.updateRequirementResponse(payment.requirement_response_id, { status: newResponseStatus });
      } catch (e) {
        console.warn('Could not set status:', e.message);
      }

      if (io) {
        if (payment.payment_number === 1) {
          io.emit('payment:verified_admin_action_needed', {
            paymentId: updatedPayment.id,
            payment_number: 1,
            requirementResponseId: payment.requirement_response_id,
            message: 'Payment 1 verified. Please mark M1 payout as paid in Milestones tab.'
          });
        }
        io.to(`user:${payment.manufacturer_id}`).emit('payment:verified', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          amount: updatedPayment.amount,
          response_status: newResponseStatus
        });
        io.to(`user:${payment.buyer_id}`).emit('payment:verified', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          amount: updatedPayment.amount,
          response_status: newResponseStatus
        });
      }

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
      const adminNote = isValidUuid ? '' : `Rejected by admin: ${req.user.userId}. `;
      updatedPayment = await databaseService.updatePayment(paymentId, {
        status: 'failed',
        verified_by: isValidUuid ? req.user.userId : null,
        verified_at: new Date().toISOString(),
        notes: adminNote + (notes || 'Payment verification failed')
      });

      if (io) {
        io.to(`user:${payment.buyer_id}`).emit('payment:rejected', {
          payment_id: updatedPayment.id,
          payment_number: updatedPayment.payment_number,
          reason: notes || 'Payment verification failed. Please retry.'
        });
      }

      notifyAsync(async () => {
        const buyer = await databaseService.findBuyerProfile(payment.buyer_id);
        if (buyer?.phone_number) {
          await whatsappService.notifyPaymentRejected(buyer.phone_number, updatedPayment, notes);
        }
      }, 'WhatsApp notification (payment rejected)');
    }

    ok(res, {
      message: approved ? 'Payment verified successfully' : 'Payment rejected',
      data: { payment_id: updatedPayment.id, status: updatedPayment.status, response_status: newResponseStatus || null }
    });
  } catch (err) {
    fail(res, 'Failed to verify payment', 500);
  }
};

const refundPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return fail(res, 'Refund reason is required (minimum 5 characters)');
    }

    const payment = await databaseService.getPaymentById(paymentId);
    if (!payment) return fail(res, 'Payment not found', 404);
    if (payment.status !== 'paid') return fail(res, `Cannot refund payment with status: ${payment.status}`);

    const updated = await databaseService.updatePayment(paymentId, {
      status: 'refunded',
      refund_reason: reason.trim(),
      refunded_at: new Date().toISOString()
    });

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${payment.buyer_id}`).emit('payment:refunded', {
        payment_id: updated.id, amount: updated.amount, reason: reason.trim()
      });
    }

    ok(res, { message: 'Payment refunded successfully', data: updated });
  } catch (err) {
    fail(res, 'Failed to refund payment', 500);
  }
};

module.exports = { createQr, submitUtr, getStatus, getMyPayments, getPendingAdmin, verifyPayment, refundPayment };