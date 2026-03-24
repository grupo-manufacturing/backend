const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');

let io = null;

router.setIo = (socketIo) => {
  io = socketIo;
};

const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7);
    
    const ADMIN_TOKENS = [
      'demo_admin_token',
      process.env.ADMIN_TOKEN
    ].filter(Boolean);
    
    if (ADMIN_TOKENS.includes(token)) {
      req.user = {
        userId: 'admin_demo',
        role: 'admin',
        phoneNumber: 'admin',
        verified: true
      };
      return next();
    }
    
    try {
      const authService = require('../services/authService');
      const decoded = authService.verifyJWT(token);
      
      if (decoded.role === 'admin') {
        req.user = {
          userId: decoded.userId,
          role: decoded.role,
          phoneNumber: decoded.phoneNumber,
          verified: true
        };
        return next();
      }
    } catch {
      // JWT verification failed
    }
    
    return res.status(403).json({
      success: false,
      message: 'Access denied. Invalid admin token.'
    });
  } catch (error) {
    console.error('Admin authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// POST /api/milestones/complete - Manufacturer marks milestone as done
// For M1: in_production -> milestone_1_pending
// For M2: milestone_1_done (after M1 paid) -> milestone_2_pending
router.post('/complete', authenticateToken, async (req, res) => {
  try {
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
          message: `Cannot mark M1 complete from status "${currentStatus}". Order must be in_production.`
        });
      }
      newStatus = 'milestone_1_pending';
      timestampField = 'm1_marked_at';
    } else {
      // M2: can only mark after M1 payout is done
      if (currentStatus !== 'milestone_1_done') {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M2 complete from status "${currentStatus}". M1 payout must be completed first.`
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
    (async () => {
      try {
        if (buyer && buyer.phone_number) {
          await whatsappService.notifyMilestonePendingApproval(
            buyer.phone_number,
            milestone,
            requirement,
            manufacturer
          );
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

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
router.post('/approve/:responseId', authenticateToken, async (req, res) => {
  try {
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
    if (io) {
      // Notify manufacturer
      io.to(`user:${response.manufacturer_id}`).emit('milestone:approved', {
        responseId,
        milestone,
        status: newStatus
      });

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
    (async () => {
      try {
        if (manufacturer && manufacturer.phone_number) {
          await whatsappService.notifyMilestoneApproved(
            manufacturer.phone_number,
            milestone,
            requirement
          );
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

    return res.status(200).json({
      success: true,
      message: `Milestone ${milestone.toUpperCase()} approved. Awaiting admin payout.`,
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
router.post('/mark-paid/:responseId', authenticateAdmin, async (req, res) => {
  try {
    const { responseId } = req.params;
    const { milestone, transactionRef, notes } = req.body;

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

    if (milestone === 'm1') {
      expectedStatus = 'milestone_1_done';
      timestampField = 'm1_paid_at';
      
      if (currentStatus !== expectedStatus) {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M1 payout from status "${currentStatus}". Buyer must approve M1 first (status should be "${expectedStatus}").`
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
      expectedStatus = 'milestone_2_done';
      timestampField = 'm2_paid_at';
      
      if (currentStatus !== expectedStatus) {
        return res.status(400).json({
          success: false,
          message: `Cannot mark M2 payout from status "${currentStatus}". Buyer must approve M2 first (status should be "${expectedStatus}").`
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

    // Optionally store transaction reference in notes
    if (transactionRef || notes) {
      const existingNotes = response.notes || '';
      const payoutNote = `\n[${milestone.toUpperCase()} Payout - ${new Date().toISOString()}] ${transactionRef || ''} ${notes || ''}`.trim();
      updateData.notes = existingNotes + payoutNote;
    }

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Calculate payout amount (25% of quoted price)
    const payoutAmount = response.quoted_price ? (response.quoted_price * 0.25) : 0;

    // Emit socket event to manufacturer
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('milestone:payout_completed', {
        responseId,
        milestone,
        payoutAmount,
        canProceedToNextStep: milestone === 'm1' // After M1 payout, manufacturer can start M2
      });
    }

    // Send WhatsApp notification to manufacturer
    (async () => {
      try {
        if (manufacturer && manufacturer.phone_number) {
          await whatsappService.notifyMilestonePayoutCompleted(
            manufacturer.phone_number,
            milestone,
            payoutAmount,
            requirement,
            transactionRef
          );
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

    return res.status(200).json({
      success: true,
      message: `${milestone.toUpperCase()} payout marked as completed. Manufacturer notified.`,
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
    const supabase = require('../config/supabase');
    
    // Get all responses where M1, M2 is done but not yet paid, OR delivered but final not paid
    const { data: responses, error } = await supabase
      .from('requirement_responses')
      .select(`
        *,
        requirement:requirements(
          id,
          requirement_no,
          product_type,
          quantity,
          buyer_id,
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        ),
        manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
      `)
      .or('status.eq.milestone_1_done,status.eq.milestone_2_done,status.eq.delivered')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    // Filter to only those not yet paid and determine payout type
    const pendingPayouts = (responses || []).filter(r => {
      if (r.status === 'milestone_1_done' && !r.m1_paid_at) return true;
      if (r.status === 'milestone_2_done' && !r.m2_paid_at) return true;
      if (r.status === 'delivered' && !r.final_paid_at) return true;
      return false;
    }).map(r => {
      let pendingMilestone;
      let payoutAmount;
      let payoutLabel;
      
      if (r.status === 'milestone_1_done' && !r.m1_paid_at) {
        pendingMilestone = 'm1';
        payoutAmount = r.quoted_price ? (r.quoted_price * 0.25) : 0;
        payoutLabel = 'M1 Payout (25%)';
      } else if (r.status === 'milestone_2_done' && !r.m2_paid_at) {
        pendingMilestone = 'm2';
        payoutAmount = r.quoted_price ? (r.quoted_price * 0.25) : 0;
        payoutLabel = 'M2 Payout (25%)';
      } else {
        pendingMilestone = 'final';
        payoutAmount = r.quoted_price ? (r.quoted_price * 0.5) : 0;
        payoutLabel = 'Final Payout (50%)';
      }
      
      return {
        ...r,
        pendingMilestone,
        payoutAmount,
        payoutLabel
      };
    });

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
router.post('/mark-final-paid/:responseId', authenticateAdmin, async (req, res) => {
  try {
    const { responseId } = req.params;
    const { transactionRef, notes } = req.body;

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

    // Store transaction reference in notes if provided
    if (transactionRef || notes) {
      const existingNotes = response.notes || '';
      const payoutNote = `\n[Final Payout - ${new Date().toISOString()}] ${transactionRef || ''} ${notes || ''}`.trim();
      updateData.notes = existingNotes + payoutNote;
    }

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Calculate final payout amount (50% of quoted price)
    const payoutAmount = response.quoted_price ? (response.quoted_price * 0.5) : 0;

    // Emit socket event to manufacturer
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('order:completed', {
        responseId,
        status: 'completed',
        payoutAmount
      });
    }

    // Send WhatsApp notification to manufacturer
    (async () => {
      try {
        if (manufacturer && manufacturer.phone_number) {
          await whatsappService.notifyFinalPayoutCompleted(
            manufacturer.phone_number,
            payoutAmount,
            requirement,
            transactionRef
          );
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

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
