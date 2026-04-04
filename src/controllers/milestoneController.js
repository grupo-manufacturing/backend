const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { ok, fail } = require('../utils/response');
const PAYOUT_RATES = require('../constants/payoutRates');
const notifyAsync = require('../utils/notifyAsync');

const normalizeTransactionRef = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const complete = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can mark milestones as complete', 403);

    const { responseId, milestone } = req.body;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);
    if (response.manufacturer_id !== req.user.userId) return fail(res, 'You can only mark milestones for your own orders', 403);

    const currentStatus = response.status;
    let newStatus, timestampField;

    if (milestone === 'm1') {
      if (currentStatus !== 'in_production') {
        return fail(res, `Cannot mark M1 complete from status "${currentStatus}". Order must be in_production (M1 payout must be marked as paid first).`);
      }
      newStatus = 'milestone_1_pending';
      timestampField = 'm1_marked_at';
    } else {
      if (!response.m1_paid_at || !response.m2_paid_at || currentStatus !== 'milestone_1_done') {
        return fail(res, 'Cannot mark M2 complete. M1 must be approved, M1 payout paid, and M2 payout paid first.');
      }
      newStatus = 'milestone_2_pending';
      timestampField = 'm2_marked_at';
    }

    const updated = await databaseService.updateRequirementResponse(responseId, {
      status: newStatus,
      [timestampField]: new Date().toISOString()
    });

    const requirement = await databaseService.getRequirement(response.requirement_id);
    const buyer = requirement ? await databaseService.findBuyerProfile(requirement.buyer_id) : null;
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    const io = req.app.locals.io;
    if (io && requirement) {
      io.to(`user:${requirement.buyer_id}`).emit('milestone:pending', {
        responseId, milestone, status: newStatus,
        response: { ...updated, manufacturer: manufacturer || null }
      });
    }

    notifyAsync(async () => {
      if (buyer?.phone_number) {
        await whatsappService.notifyMilestonePendingApproval(buyer.phone_number, milestone, requirement, manufacturer);
      }
    }, 'WhatsApp notification (milestone pending)');

    ok(res, { message: `Milestone ${milestone.toUpperCase()} marked as pending buyer approval`, data: updated });
  } catch (err) {
    fail(res, 'Failed to mark milestone complete', 500);
  }
};

const approve = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can approve milestones', 403);

    const { responseId } = req.params;
    const { milestone } = req.body;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You can only approve milestones for your own orders', 403);
    }

    const expectedStatus = milestone === 'm1' ? 'milestone_1_pending' : 'milestone_2_pending';
    const newStatus = milestone === 'm1' ? 'milestone_1_done' : 'milestone_2_done';
    const timestampField = milestone === 'm1' ? 'm1_approved_at' : 'm2_approved_at';

    if (response.status !== expectedStatus) {
      return fail(res, `Cannot approve ${milestone.toUpperCase()} from status "${response.status}". Expected "${expectedStatus}".`);
    }

    const updated = await databaseService.updateRequirementResponse(responseId, {
      status: newStatus,
      [timestampField]: new Date().toISOString()
    });

    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const io = req.app.locals.io;

    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('milestone:approved', { responseId, milestone, status: newStatus });

      if (milestone === 'm1') {
        io.emit('milestone:m1_approved_admin_action_needed', {
          responseId,
          message: 'M1 approved by buyer. Please mark M2 payout as paid in Milestones tab to allow production to proceed.'
        });
      }

      io.emit('milestone:ready_for_payout', { responseId, milestone, status: newStatus, requirement, manufacturer });
    }

    notifyAsync(async () => {
      if (manufacturer?.phone_number) {
        await whatsappService.notifyMilestoneApproved(manufacturer.phone_number, milestone, requirement);
      }
    }, 'WhatsApp notification (milestone approved)');

    ok(res, {
      message: `Milestone ${milestone.toUpperCase()} approved.${milestone === 'm1' ? ' Admin will mark M2 payout next.' : ' Awaiting payment 2.'}`,
      data: updated
    });
  } catch (err) {
    fail(res, 'Failed to approve milestone', 500);
  }
};

const markPaid = async (req, res) => {
  try {
    const { responseId } = req.params;
    const { milestone, transactionRef } = req.body;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    const currentStatus = response.status;
    let expectedStatus, timestampField, newStatus;

    if (milestone === 'm1') {
      expectedStatus = 'accepted';
      timestampField = 'm1_paid_at';
      newStatus = 'in_production';

      if (currentStatus !== expectedStatus) {
        return fail(res, `Cannot mark M1 payout from status "${currentStatus}". Payment 1 must be verified first (status should be "${expectedStatus}").`);
      }
      if (response.m1_paid_at) return fail(res, 'M1 payout has already been marked as paid');
    } else {
      expectedStatus = 'milestone_1_done';
      timestampField = 'm2_paid_at';
      newStatus = 'milestone_1_done';

      if (currentStatus !== expectedStatus) {
        return fail(res, `Cannot mark M2 payout from status "${currentStatus}". M1 must be approved and M1 payout marked as paid first (status should be "${expectedStatus}").`);
      }
      if (response.m2_paid_at) return fail(res, 'M2 payout has already been marked as paid');
    }

    const normalizedRef = normalizeTransactionRef(transactionRef);
    if (normalizedRef && normalizedRef.length > 100) return fail(res, 'transactionRef must be at most 100 characters');

    const updateData = {
      [timestampField]: new Date().toISOString(),
      ...(milestone === 'm1' && { status: newStatus, m1_transaction_ref: normalizedRef }),
      ...(milestone === 'm2' && { m2_transaction_ref: normalizedRef })
    };

    const updated = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    const payoutAmount = milestone === 'm1'
      ? (response.quoted_price ? response.quoted_price * PAYOUT_RATES.M1_NET : 0)
      : (response.quoted_price ? response.quoted_price * PAYOUT_RATES.M2_NET : 0);

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('milestone:payout_completed', {
        responseId, milestone, payoutAmount,
        message: milestone === 'm1'
          ? 'M1 payout marked as paid. Start sample process now.'
          : 'M2 payout marked as paid. Start full production now.'
      });
    }

    notifyAsync(async () => {
      if (manufacturer?.phone_number) {
        await whatsappService.notifyMilestonePayoutCompleted(manufacturer.phone_number, milestone, requirement, transactionRef);
      }
    }, 'WhatsApp notification (milestone payout)');

    ok(res, {
      message: `${milestone.toUpperCase()} payout marked as completed. Manufacturer notified and can now proceed.`,
      data: { ...updated, payoutAmount }
    });
  } catch (err) {
    fail(res, 'Failed to mark payout as complete', 500);
  }
};

const getPendingPayouts = async (req, res) => {
  try {
    const pendingPayouts = await databaseService.getPendingMilestonePayouts();
    ok(res, { data: pendingPayouts, count: pendingPayouts.length });
  } catch (err) {
    fail(res, 'Failed to fetch pending payouts', 500);
  }
};

const markFinalPaid = async (req, res) => {
  try {
    const { responseId } = req.params;
    const { transactionRef } = req.body;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    if (response.status !== 'delivered') {
      return fail(res, `Cannot mark final payout from status "${response.status}". Buyer must confirm delivery first (status should be "delivered").`);
    }
    if (response.final_paid_at) return fail(res, 'Final payout has already been marked as paid');

    const normalizedRef = normalizeTransactionRef(transactionRef);
    const updated = await databaseService.updateRequirementResponse(responseId, {
      status: 'completed',
      final_paid_at: new Date().toISOString(),
      final_transaction_ref: normalizedRef
    });

    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const payoutAmount = response.quoted_price ? response.quoted_price * PAYOUT_RATES.FINAL_NET : 0;

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('order:completed', {
        responseId, status: 'completed', payoutAmount
      });
    }

    notifyAsync(async () => {
      if (manufacturer?.phone_number) {
        await whatsappService.notifyFinalPayoutCompleted(manufacturer.phone_number, requirement, transactionRef);
      }
    }, 'WhatsApp notification (final payout)');

    ok(res, {
      message: 'Final payout marked as completed. Order is now complete!',
      data: { ...updated, payoutAmount }
    });
  } catch (err) {
    fail(res, 'Failed to mark final payout', 500);
  }
};

const getStatus = async (req, res) => {
  try {
    const { responseId } = req.params;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);

    if (req.user.role === 'buyer' && requirement?.buyer_id !== req.user.userId) {
      return fail(res, 'Not authorized to view this milestone status', 403);
    }
    if (req.user.role === 'manufacturer' && response.manufacturer_id !== req.user.userId) {
      return fail(res, 'Not authorized to view this milestone status', 403);
    }

    ok(res, {
      data: {
        currentStatus: response.status,
        m1: {
          markedAt: response.m1_marked_at || null,
          approvedAt: response.m1_approved_at || null,
          paidAt: response.m1_paid_at || null,
          isPending: response.status === 'milestone_1_pending',
          isDone: response.status === 'milestone_1_done' || !!response.m1_paid_at,
          isPaid: !!response.m1_paid_at
        },
        m2: {
          markedAt: response.m2_marked_at || null,
          approvedAt: response.m2_approved_at || null,
          paidAt: response.m2_paid_at || null,
          isPending: response.status === 'milestone_2_pending',
          isDone: response.status === 'milestone_2_done' || !!response.m2_paid_at,
          isPaid: !!response.m2_paid_at
        }
      }
    });
  } catch (err) {
    fail(res, 'Failed to fetch milestone status', 500);
  }
};

module.exports = { complete, approve, markPaid, getPendingPayouts, markFinalPaid, getStatus };