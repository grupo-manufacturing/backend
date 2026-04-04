const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { ok, fail } = require('../utils/response');
const PAYOUT_RATES = require('../constants/payoutRates');
const notifyAsync = require('../utils/notifyAsync');

const normalizeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const shipOrder = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return fail(res, 'Only manufacturers can mark orders as shipped', 403);
    }

    const { responseId } = req.params;
    const { trackingId, courierName, trackingNumber, shippingProvider, notes } = req.body;

    const normalizedTrackingId = normalizeText(trackingId) || normalizeText(trackingNumber);
    const normalizedCourierName = normalizeText(courierName) || normalizeText(shippingProvider);
    const normalizedShippingNotes = normalizeText(notes);

    if (!normalizedCourierName || !normalizedTrackingId) {
      return fail(res, 'Courier name and tracking ID are required before marking as shipped.');
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Order not found', 404);

    if (response.manufacturer_id !== req.user.userId) {
      return fail(res, 'You can only ship your own orders', 403);
    }

    if (response.status !== 'cleared_to_ship') {
      return fail(res, `Cannot ship order with status "${response.status}". Order must be cleared_to_ship.`);
    }

    if (normalizedCourierName.length > 100 || normalizedTrackingId.length > 120) {
      return fail(res, 'Courier name or tracking ID is too long');
    }

    if (normalizedShippingNotes && normalizedShippingNotes.length > 1000) {
      return fail(res, 'Shipping notes must be at most 1000 characters');
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

    notifyAsync(async () => {
      if (buyer?.phone_number) {
        await whatsappService.notifyOrderShipped(
          buyer.phone_number, requirement, normalizedTrackingId, normalizedCourierName
        );
      }
    }, 'WhatsApp notification (order shipped)');

    ok(res, { message: 'Order marked as shipped. Buyer has been notified.', data: updatedResponse });
  } catch (err) {
    fail(res, 'Failed to mark order as shipped', 500);
  }
};

const confirmDelivery = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return fail(res, 'Only buyers can confirm delivery', 403);
    }

    const { responseId } = req.params;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Order not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You can only confirm delivery for your own orders', 403);
    }

    if (response.status !== 'shipped') {
      return fail(res, `Cannot confirm delivery for order with status "${response.status}". Order must be shipped.`);
    }

    const updateData = {
      status: 'delivered',
      delivered_at: new Date().toISOString()
    };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('order:delivered', {
        responseId, status: 'delivered', delivered_at: updateData.delivered_at
      });

      io.emit('order:delivery_confirmed', {
        responseId,
        status: 'delivered',
        requirement,
        manufacturer,
        quoted_price: response.quoted_price,
        final_payout_amount: response.quoted_price ? response.quoted_price * PAYOUT_RATES.FINAL_NET : 0
      });
    }

    notifyAsync(async () => {
      if (manufacturer?.phone_number) {
        await whatsappService.notifyDeliveryConfirmed(manufacturer.phone_number, requirement);
      }
    }, 'WhatsApp notification (delivery confirmed)');

    ok(res, { message: 'Delivery confirmed. Thank you for your order!', data: updatedResponse });
  } catch (err) {
    fail(res, 'Failed to confirm delivery', 500);
  }
};

const getReadyToShip = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return fail(res, 'Only manufacturers can access this endpoint', 403);
    }

    const orders = await databaseService.getReadyToShipOrders(req.user.userId);
    ok(res, { data: orders || [], count: (orders || []).length });
  } catch (err) {
    fail(res, 'Failed to fetch orders', 500);
  }
};

module.exports = { shipOrder, confirmDelivery, getReadyToShip };