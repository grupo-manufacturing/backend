const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const PAYOUT_RATES = require('../constants/payoutRates');
const notifyAsync = require('../utils/notifyAsync');

const normalizeTransactionRef = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

const validateMilestoneBody = [
  body('milestone')
    .notEmpty()
    .withMessage('milestone is required')
    .isIn(['m1', 'm2'])
    .withMessage('milestone must be m1 or m2')
];

const validateResponseIdParam = [
  param('responseId')
    .notEmpty()
    .withMessage('responseId is required')
    .isUUID()
    .withMessage('responseId must be a valid UUID')
];

const validateTransactionRef = [
  body('transactionRef')
    .optional({ nullable: true })
    .isString()
    .withMessage('transactionRef must be a string')
    .isLength({ max: 100 })
    .withMessage('transactionRef must be at most 100 characters')
];

const validateCompleteMilestone = [
  body('responseId')
    .notEmpty()
    .withMessage('responseId is required')
    .isUUID()
    .withMessage('responseId must be a valid UUID'),
  ...validateMilestoneBody
];

function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
    return true;
  }
  return false;
}

// POST /api/milestones/complete - Manufacturer marks milestone as done
// For M1: in_production -> milestone_1_pending
// For M2: milestone_1_done (after M1 paid) -> milestone_2_pending
router.post('/complete', authenticateToken, validateCompleteMilestone, async (req, res) => {
  try {
    if (handleValidationErrors(req, res)) return;

    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can mark milestones as complete'
      });
    }

    const { responseId, milestone } = req.body;

    if (!responseId || !milestone || !['m1', 'm2'].includes(milestone)) {
      return res.status(400).json({
        success: false,
        message: 'responseId and milestone (m1 or m2) are required'
      });
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    if (response.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only mark milestones for your own orders'
      });
    }

    const currentStatus = response.status;
    let newStatus;
    let timestampField;

    if (milestone === 'm1') {
      if (currentStatus !== 'in_production') {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M1 complete from status "${currentStatus}". Order must be in_production (M1 payout must be marked as paid first).`
        });
      }
      newStatus = 'milestone_1_pending';
      timestampField = 'm1_marked_at';
    } else {
      // M2: can only mark after M1 payout is paid and M2 payout is paid
      if (!response.m1_paid_at || !response.m2_paid_at || currentStatus !== 'milestone_1_done') {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M2 complete. M1 must be approved, M1 payout paid, and M2 payout paid first.`
        });
      }
      newStatus = 'milestone_2_pending';
      timestampField = 'm2_marked_at';
    }

    const updateData = {
      status: newStatus,
      [timestampField]: new Date().toISOString()
    };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const buyer = requirement ? await databaseService.findBuyerProfile(requirement.buyer_id) : null;
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Emit socket event to buyer
    const io = req.app.locals.io;
    if (io && requirement) {
      io.to(`user:${requirement.buyer_id}`).emit('milestone:pending', {
        responseId,
        milestone,
        status: newStatus,
        response: {
          ...updatedResponse,
          manufacturer: manufacturer || null
        }
      });
    }

    // Send WhatsApp notification to buyer
    notifyAsync(async () => {
      if (buyer && buyer.phone_number) {
        await whatsappService.notifyMilestonePendingApproval(
          buyer.phone_number,
          milestone,
          requirement,
          manufacturer
        );
      }
    }, 'WhatsApp notification (milestone pending)');

    return res.status(200).json({
      success: true,
      message: `Milestone ${milestone.toUpperCase()} marked as pending buyer approval`,
      data: updatedResponse
    });
  } catch (error) {
    console.error('Mark milestone complete error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark milestone complete',
      error: error.message
    });
  }
});

// POST /api/milestones/approve/:responseId - Buyer approves milestone
// M1: milestone_1_pending -> milestone_1_done
// M2: milestone_2_pending -> milestone_2_done
router.post('/approve/:responseId', authenticateToken, [...validateResponseIdParam, ...validateMilestoneBody], async (req, res) => {
  try {
    if (handleValidationErrors(req, res)) return;

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can approve milestones'
      });
    }

    const { responseId } = req.params;
    const { milestone } = req.body;

    if (!milestone || !['m1', 'm2'].includes(milestone)) {
      return res.status(400).json({
        success: false,
        message: 'milestone (m1 or m2) is required'
      });
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only approve milestones for your own orders'
      });
    }

    const currentStatus = response.status;
    let expectedStatus;
    let newStatus;
    let timestampField;

    if (milestone === 'm1') {
      expectedStatus = 'milestone_1_pending';
      newStatus = 'milestone_1_done';
      timestampField = 'm1_approved_at';
    } else {
      expectedStatus = 'milestone_2_pending';
      newStatus = 'milestone_2_done';
      timestampField = 'm2_approved_at';
    }

    if (currentStatus !== expectedStatus) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve ${milestone.toUpperCase()} from status "${currentStatus}". Expected "${expectedStatus}".`
      });
    }

    const updateData = {
      status: newStatus,
      [timestampField]: new Date().toISOString()
    };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Emit socket events
    const io = req.app.locals.io;
    if (io) {
      // Notify manufacturer
      io.to(`user:${response.manufacturer_id}`).emit('milestone:approved', {
        responseId,
        milestone,
        status: newStatus
      });

      // Notify admin that M1 is approved and ready for manual M2 payout release (only for M1)
      if (milestone === 'm1') {
        io.emit('milestone:m1_approved_admin_action_needed', {
          responseId,
          message: 'M1 approved by buyer. Please mark M2 payout as paid in Milestones tab to allow production to proceed.'
        });
      }

      // Notify admin (broadcast to admin room or specific admin users)
      io.emit('milestone:ready_for_payout', {
        responseId,
        milestone,
        status: newStatus,
        requirement,
        manufacturer
      });
    }

    // Send WhatsApp notification to admin (if configured) and manufacturer
    notifyAsync(async () => {
      if (manufacturer && manufacturer.phone_number) {
        await whatsappService.notifyMilestoneApproved(
          manufacturer.phone_number,
          milestone,
          requirement
        );
      }
    }, 'WhatsApp notification (milestone approved)');

    return res.status(200).json({
      success: true,
      message: `Milestone ${milestone.toUpperCase()} approved.${milestone === 'm1' ? ' Admin will mark M2 payout next.' : ' Awaiting payment 2.'}`,
      data: updatedResponse
    });
  } catch (error) {
    console.error('Approve milestone error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve milestone',
      error: error.message
    });
  }
});

// POST /api/milestones/mark-paid/:responseId - Admin marks milestone payout as transferred
// M1: milestone_1_done -> (stays milestone_1_done but m1_paid_at is set)
// After M1 paid, manufacturer can proceed to M2
router.post('/mark-paid/:responseId', authenticateAdmin, [...validateResponseIdParam, ...validateMilestoneBody, ...validateTransactionRef], async (req, res) => {
  try {
    if (handleValidationErrors(req, res)) return;

    const { responseId } = req.params;
    const { milestone, transactionRef } = req.body;

    if (!milestone || !['m1', 'm2'].includes(milestone)) {
      return res.status(400).json({
        success: false,
        message: 'milestone (m1 or m2) is required'
      });
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const currentStatus = response.status;
    let expectedStatus;
    let timestampField;
    let newStatus;

    if (milestone === 'm1') {
      expectedStatus = 'accepted';  // M1 payout can be marked when status is 'accepted' (after payment 1 verified)
      timestampField = 'm1_paid_at';
      newStatus = 'in_production';
      
      if (currentStatus !== expectedStatus) {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M1 payout from status "${currentStatus}". Payment 1 must be verified first (status should be "${expectedStatus}").`
        });
      }
      
      // Check if already paid
      if (response.m1_paid_at) {
        return res.status(400).json({
          success: false,
          message: 'M1 payout has already been marked as paid'
        });
      }
    } else {
      expectedStatus = 'milestone_1_done';
      timestampField = 'm2_paid_at';
      newStatus = 'milestone_1_done'; // Status doesn't change, just m2_paid_at is set
      
      if (currentStatus !== expectedStatus) {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M2 payout from status "${currentStatus}". M1 must be approved and M1 payout marked as paid first (status should be "${expectedStatus}").`
        });
      }
      
      if (response.m2_paid_at) {
        return res.status(400).json({
          success: false,
          message: 'M2 payout has already been marked as paid'
        });
      }
    }

    const updateData = {
      [timestampField]: new Date().toISOString()
    };

    // For M1, also transition status to 'in_production'
    if (milestone === 'm1') {
      updateData.status = newStatus;
    }

    const normalizedTransactionRef = normalizeTransactionRef(transactionRef);
    if (normalizedTransactionRef && normalizedTransactionRef.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'transactionRef must be at most 100 characters'
      });
    }

    if (milestone === 'm1') {
      updateData.m1_transaction_ref = normalizedTransactionRef;
    } else {
      updateData.m2_transaction_ref = normalizedTransactionRef;
    }

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Calculate payout amount after platform fee deduction
    // M1: 30% - 3% fee = 27% to manufacturer
    // M2: 20% - 2% fee = 18% to manufacturer
    const payoutAmount = milestone === 'm1'
      ? (response.quoted_price ? (response.quoted_price * PAYOUT_RATES.M1_NET) : 0)
      : (response.quoted_price ? (response.quoted_price * PAYOUT_RATES.M2_NET) : 0);

    // Emit socket event to manufacturer
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('milestone:payout_completed', {
        responseId,
        milestone,
        payoutAmount,
        message: milestone === 'm1' ? 'M1 payout marked as paid. Start sample process now.' : 'M2 payout marked as paid. Start full production now.'
      });
    }

    // Send WhatsApp notification to manufacturer
    notifyAsync(async () => {
      if (manufacturer && manufacturer.phone_number) {
        await whatsappService.notifyMilestonePayoutCompleted(
          manufacturer.phone_number,
          milestone,
          requirement,
          transactionRef
        );
      }
    }, 'WhatsApp notification (milestone payout)');

    return res.status(200).json({
      success: true,
      message: `${milestone.toUpperCase()} payout marked as completed. Manufacturer notified and can now proceed.`,
      data: {
        ...updatedResponse,
        payoutAmount
      }
    });
  } catch (error) {
    console.error('Mark payout complete error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark payout as complete',
      error: error.message
    });
  }
});

// GET /api/milestones/pending-payouts - Admin gets all milestones awaiting payout
router.get('/pending-payouts', authenticateAdmin, async (req, res) => {
  try {
    const pendingPayouts = await databaseService.getPendingMilestonePayouts();

    return res.status(200).json({
      success: true,
      data: pendingPayouts,
      count: pendingPayouts.length
    });
  } catch (error) {
    console.error('Get pending payouts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending payouts',
      error: error.message
    });
  }
});

// POST /api/milestones/mark-final-paid/:responseId - Admin marks final payout as transferred
router.post('/mark-final-paid/:responseId', authenticateAdmin, [...validateResponseIdParam, ...validateTransactionRef], async (req, res) => {
  try {
    if (handleValidationErrors(req, res)) return;

    const { responseId } = req.params;
    const { transactionRef } = req.body;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    if (response.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: `Cannot mark final payout from status "${response.status}". Buyer must confirm delivery first (status should be "delivered").`
      });
    }

    if (response.final_paid_at) {
      return res.status(400).json({
        success: false,
        message: 'Final payout has already been marked as paid'
      });
    }

    const updateData = {
      status: 'completed',
      final_paid_at: new Date().toISOString()
    };

    const normalizedTransactionRef = normalizeTransactionRef(transactionRef);
    updateData.final_transaction_ref = normalizedTransactionRef;

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Calculate final payout amount after platform fee deduction
    // Final: 50% - 5% fee = 45% to manufacturer
    const payoutAmount = response.quoted_price ? (response.quoted_price * PAYOUT_RATES.FINAL_NET) : 0;

    // Emit socket event to manufacturer
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('order:completed', {
        responseId,
        status: 'completed',
        payoutAmount
      });
    }

    // Send WhatsApp notification to manufacturer
    notifyAsync(async () => {
      if (manufacturer && manufacturer.phone_number) {
        await whatsappService.notifyFinalPayoutCompleted(
          manufacturer.phone_number,
          requirement,
          transactionRef
        );
      }
    }, 'WhatsApp notification (final payout)');

    return res.status(200).json({
      success: true,
      message: 'Final payout marked as completed. Order is now complete!',
      data: {
        ...updatedResponse,
        payoutAmount
      }
    });
  } catch (error) {
    console.error('Mark final payout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark final payout',
      error: error.message
    });
  }
});

// GET /api/milestones/status/:responseId - Get milestone status for a response
router.get('/status/:responseId', authenticateToken, async (req, res) => {
  try {
    const { responseId } = req.params;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const requirement = await databaseService.getRequirement(response.requirement_id);
    
    // Authorization: buyer owns requirement or manufacturer owns response
    if (req.user.role === 'buyer' && requirement?.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this milestone status'
      });
    }
    
    if (req.user.role === 'manufacturer' && response.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this milestone status'
      });
    }

    const milestoneStatus = {
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
    };

    return res.status(200).json({
      success: true,
      data: milestoneStatus
    });
  } catch (error) {
    console.error('Get milestone status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch milestone status',
      error: error.message
    });
  }
});

module.exports = router;
