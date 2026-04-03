const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');
const PAYOUT_RATES = require('../constants/payoutRates');
const notifyAsync = require('../utils/notifyAsync');

const normalizeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

// POST /api/orders/ship/:responseId - Manufacturer marks order as shipped
router.post('/ship/:responseId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can mark orders as shipped'
      });
    }

    const { responseId } = req.params;
    const { trackingId, courierName, trackingNumber, shippingProvider, notes } = req.body;
    const normalizedTrackingId = normalizeText(trackingId) || normalizeText(trackingNumber);
    const normalizedCourierName = normalizeText(courierName) || normalizeText(shippingProvider);
    const normalizedShippingNotes = normalizeText(notes);

    if (!normalizedCourierName || !normalizedTrackingId) {
      return res.status(400).json({
        success: false,
        message: 'Courier name and tracking ID are required before marking as shipped.'
      });
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (response.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only ship your own orders'
      });
    }

    if (response.status !== 'cleared_to_ship') {
      return res.status(400).json({
        success: false,
        message: `Cannot ship order with status "${response.status}". Order must be cleared_to_ship.`
      });
    }

    if (normalizedCourierName.length > 100 || normalizedTrackingId.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'Courier name or tracking ID is too long'
      });
    }

    if (normalizedShippingNotes && normalizedShippingNotes.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Shipping notes must be at most 1000 characters'
      });
    }

    const updateData = {
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipping_courier_name: normalizedCourierName,
      shipping_tracking_id: normalizedTrackingId,
      shipping_notes: normalizedShippingNotes
    };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const requirement = await databaseService.getRequirement(response.requirement_id);
    const buyer = requirement ? await databaseService.findBuyerProfile(requirement.buyer_id) : null;

    // Emit socket event to buyer
    const io = req.app.locals.io;
    if (io && requirement) {
      io.to(`user:${requirement.buyer_id}`).emit('order:shipped', {
        responseId,
        status: 'shipped',
        shipped_at: updateData.shipped_at,
        trackingId: normalizedTrackingId,
        courierName: normalizedCourierName,
        trackingNumber: normalizedTrackingId,
        shippingProvider: normalizedCourierName
      });
    }

    // Send WhatsApp notification to buyer
    notifyAsync(async () => {
      if (buyer && buyer.phone_number) {
        await whatsappService.notifyOrderShipped(
          buyer.phone_number,
          requirement,
          normalizedTrackingId,
          normalizedCourierName
        );
      }
    }, 'WhatsApp notification (order shipped)');

    return res.status(200).json({
      success: true,
      message: 'Order marked as shipped. Buyer has been notified.',
      data: updatedResponse
    });
  } catch (error) {
    console.error('Ship order error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark order as shipped',
      error: error.message
    });
  }
});

// POST /api/orders/confirm-delivery/:responseId - Buyer confirms delivery
router.post('/confirm-delivery/:responseId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can confirm delivery'
      });
    }

    const { responseId } = req.params;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only confirm delivery for your own orders'
      });
    }

    if (response.status !== 'shipped') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm delivery for order with status "${response.status}". Order must be shipped.`
      });
    }

    const updateData = {
      status: 'delivered',
      delivered_at: new Date().toISOString()
    };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    // Emit socket event to notify about delivery confirmation
    const io = req.app.locals.io;
    if (io) {
      // Notify manufacturer
      io.to(`user:${response.manufacturer_id}`).emit('order:delivered', {
        responseId,
        status: 'delivered',
        delivered_at: updateData.delivered_at
      });

      // Broadcast to admin (they'll see it in the milestones tab)
      io.emit('order:delivery_confirmed', {
        responseId,
        status: 'delivered',
        requirement,
        manufacturer,
        quoted_price: response.quoted_price,
        final_payout_amount: response.quoted_price ? (response.quoted_price * PAYOUT_RATES.FINAL_NET) : 0
      });
    }

    notifyAsync(async () => {
      if (manufacturer && manufacturer.phone_number) {
        await whatsappService.notifyDeliveryConfirmed(
          manufacturer.phone_number,
          requirement
        );
      }
    }, 'WhatsApp notification (delivery confirmed)');

    return res.status(200).json({
      success: true,
      message: 'Delivery confirmed. Thank you for your order!',
      data: updatedResponse
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to confirm delivery',
      error: error.message
    });
  }
});

// GET /api/orders/ready-to-ship - Manufacturer gets orders ready to ship
router.get('/ready-to-ship', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can access this endpoint'
      });
    }

    const orders = await databaseService.getReadyToShipOrders(req.user.userId);

    return res.status(200).json({
      success: true,
      data: orders || [],
      count: (orders || []).length
    });
  } catch (error) {
    console.error('Get ready to ship orders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

module.exports = router;
