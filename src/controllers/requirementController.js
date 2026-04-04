const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { ok, fail } = require('../utils/response');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');
const notifyAsync = require('../utils/notifyAsync');

const MIN_QUANTITY = 30;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;

const create = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can create requirements', 403);

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;

    const requirementData = {
      buyer_id: req.user.userId,
      product_type: product_type.trim(),
      quantity: parseInt(quantity, 10),
      requirement_text: requirement_text?.trim() || null,
      product_link: product_link?.trim() || null,
      image_url: image_url?.trim() || null,
      notes: notes?.trim() || null,
      status: 'pending'
    };

    const requirement = await databaseService.createRequirement(requirementData);
    ok(res, { message: 'Requirement created successfully', data: requirement }, 201);

    notifyAsync(async () => {
      const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
      const enriched = { ...requirement, buyer: buyer || null };
      const verifiedManufacturers = await databaseService.getAllManufacturers({ verified: true, limit: 100 });

      const io = req.app.locals.io;
      if (io && verifiedManufacturers.length > 0) {
        verifiedManufacturers.forEach(m => {
          io.to(`user:${m.id}`).emit('requirement:new', { requirement: enriched });
        });
      }

      for (let i = 0; i < verifiedManufacturers.length; i += BATCH_SIZE) {
        const batch = verifiedManufacturers.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(async (m) => {
          if (m.phone_number) {
            try {
              await whatsappService.notifyNewRequirement(m.phone_number, requirement);
            } catch (err) {
              console.error(`Failed to notify manufacturer ${m.id}:`, err.message);
            }
          }
        }));
        if (i + BATCH_SIZE < verifiedManufacturers.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
    }, 'Background requirement notification');
  } catch (err) {
    fail(res, err.message || 'Failed to create requirement', 500);
  }
};

const getAll = async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });
    const options = { limit, offset, sortBy, sortOrder };

    let requirements;
    if (req.user.role === 'buyer') {
      requirements = await databaseService.getBuyerRequirements(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      requirements = await databaseService.getAllRequirements(options);
    } else {
      return fail(res, 'Invalid user role', 403);
    }

    ok(res, { data: requirements, count: requirements.length });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch requirements', 500);
  }
};

const getBuyerStatistics = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can access requirement statistics', 403);
    const statistics = await databaseService.getBuyerRequirementStatistics(req.user.userId);
    ok(res, { data: statistics });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch requirement statistics', 500);
  }
};

const getActiveForConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await databaseService.getConversation(conversationId);

    if (!conversation) return fail(res, 'Conversation not found', 404);

    const { userId, role } = req.user;
    const isAllowed =
      (role === 'buyer' && conversation.buyer_id === userId) ||
      (role === 'manufacturer' && conversation.manufacturer_id === userId);

    if (!isAllowed) return fail(res, 'Not authorized to view requirements for this conversation', 403);

    const requirements = await databaseService.getActiveRequirementsForConversation(
      conversation.buyer_id, conversation.manufacturer_id
    );

    ok(res, { data: requirements, count: requirements.length });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch active requirements', 500);
  }
};

const getOne = async (req, res) => {
  try {
    const requirement = await databaseService.getRequirementWithBuyer(req.params.id);
    if (!requirement) return fail(res, 'Requirement not found', 404);

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to view this requirement', 403);
    }

    ok(res, { data: { ...requirement, buyer: requirement.buyer || null } });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch requirement', 500);
  }
};

const update = async (req, res) => {
  try {
    const existing = await databaseService.getRequirement(req.params.id);
    if (!existing) return fail(res, 'Requirement not found', 404);

    if (req.user.role !== 'buyer' || existing.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to update this requirement', 403);
    }

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;
    const updateData = {};

    if (requirement_text !== undefined) updateData.requirement_text = requirement_text?.trim() || null;
    if (product_type !== undefined) updateData.product_type = product_type?.trim() || null;
    if (product_link !== undefined) updateData.product_link = product_link?.trim() || null;
    if (image_url !== undefined) updateData.image_url = image_url?.trim() || null;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;

    if (quantity !== undefined) {
      if (quantity === null || quantity === '') {
        updateData.quantity = null;
      } else {
        const parsed = parseInt(quantity, 10);
        if (Number.isNaN(parsed) || parsed < MIN_QUANTITY) {
          return fail(res, `Quantity must be at least ${MIN_QUANTITY}`);
        }
        updateData.quantity = parsed;
      }
    }

    const updated = await databaseService.updateRequirement(req.params.id, updateData);
    ok(res, { message: 'Requirement updated successfully', data: updated });
  } catch (err) {
    fail(res, err.message || 'Failed to update requirement', 500);
  }
};

const remove = async (req, res) => {
  try {
    const existing = await databaseService.getRequirement(req.params.id);
    if (!existing) return fail(res, 'Requirement not found', 404);

    if (req.user.role !== 'buyer' || existing.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to delete this requirement', 403);
    }

    await databaseService.deleteRequirement(req.params.id);
    ok(res, { message: 'Requirement deleted successfully' });
  } catch (err) {
    fail(res, err.message || 'Failed to delete requirement', 500);
  }
};

const createResponse = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can respond to requirements', 403);

    const requirementId = req.params.id;
    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) return fail(res, 'Requirement not found', 404);

    const existing = await databaseService.getManufacturerResponse(requirementId, req.user.userId);
    if (existing) return fail(res, 'You have already responded to this requirement');

    const { quoted_price, price_per_unit, delivery_time, notes } = req.body;
    const responseData = {
      requirement_id: requirementId,
      manufacturer_id: req.user.userId,
      quoted_price: parseFloat(quoted_price),
      price_per_unit: parseFloat(price_per_unit),
      delivery_time: delivery_time.trim(),
      notes: notes?.trim() || null,
      status: 'submitted'
    };

    const response = await databaseService.createRequirementResponse(responseData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);

    const enriched = {
      ...response,
      requirement: { ...requirement, buyer_id: requirement.buyer_id },
      manufacturer: manufacturer || null
    };

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${requirement.buyer_id}`).emit('requirement:response:new', { response: enriched });
    }

    notifyAsync(async () => {
      const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
      if (buyer?.phone_number) {
        await whatsappService.notifyNewRequirementResponse(buyer.phone_number, response, manufacturer);
      }
    }, 'WhatsApp notification (new requirement response)');

    ok(res, { message: 'Response submitted successfully', data: response }, 201);
  } catch (err) {
    fail(res, err.message || 'Failed to submit response', 500);
  }
};

const getMyResponses = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can access this endpoint', 403);

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const responses = await databaseService.getManufacturerResponses(req.user.userId, {
      status: req.query.status, limit, offset, sortBy, sortOrder
    });

    ok(res, { data: responses, count: responses.length });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch responses', 500);
  }
};

const getResponses = async (req, res) => {
  try {
    const requirementId = req.params.id;
    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) return fail(res, 'Requirement not found', 404);

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to view these responses', 403);
    }

    const responses = await databaseService.getRequirementResponses(requirementId);
    ok(res, { data: responses, count: responses.length });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch responses', 500);
  }
};

const getResponseById = async (req, res) => {
  try {
    const { responseId } = req.params;
    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement) return fail(res, 'Requirement not found', 404);

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to view this response', 403);
    }
    if (req.user.role === 'manufacturer' && response.manufacturer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to view this response', 403);
    }

    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    ok(res, {
      data: {
        ...response,
        requirement: { ...requirement, buyer: buyer || null },
        manufacturer: manufacturer || null
      }
    });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch response', 500);
  }
};

const updateResponseStatus = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can update response status', 403);

    const { responseId } = req.params;
    const { status } = req.body;

    if (!status || !['rejected'].includes(status)) {
      return fail(res, 'Status must be "rejected". Use Accept & Pay flow for acceptance.');
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) return fail(res, 'Response not found', 404);

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return fail(res, 'You do not have permission to update this response', 403);
    }

    const updated = await databaseService.updateRequirementResponse(responseId, { status });
    await databaseService.updateRequirement(response.requirement_id, { status: 'rejected' });

    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('requirement:response:status:updated', {
        response: { ...updated, requirement: { ...requirement, buyer: buyer || null }, manufacturer: manufacturer || null },
        status
      });
    }

    notifyAsync(async () => {
      if (manufacturer?.phone_number) {
        await whatsappService.notifyResponseStatusUpdate(manufacturer.phone_number, status, requirement);
      }
    }, 'WhatsApp notification (response status update)');

    ok(res, { message: `Response ${status} successfully`, data: updated });
  } catch (err) {
    fail(res, err.message || 'Failed to update response status', 500);
  }
};

const getAdminOrders = async (req, res) => {
  try {
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });
    const orders = await databaseService.getAllRequirements({ sortBy, sortOrder });
    ok(res, { data: orders, count: orders.length });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch orders', 500);
  }
};

const getAdminMetrics = async (req, res) => {
  try {
    const [totalRevenue, topManufacturer] = await Promise.all([
      databaseService.getTotalRevenueFromResponses(),
      databaseService.getTopManufacturerByRevenue()
    ]);
    ok(res, { data: { totalRevenue, topManufacturer } });
  } catch (err) {
    fail(res, err.message || 'Failed to fetch admin overview metrics', 500);
  }
};

module.exports = {
  create,
  getAll,
  getBuyerStatistics,
  getActiveForConversation,
  getOne,
  update,
  remove,
  createResponse,
  getMyResponses,
  getResponses,
  getResponseById,
  updateResponseStatus,
  getAdminOrders,
  getAdminMetrics
};