const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');
const notifyAsync = require('../utils/notifyAsync');
const MIN_REQUIREMENT_QUANTITY = 30;

// Validation middleware for creating requirements
const validateCreateRequirement = [
  body('product_type')
    .notEmpty()
    .withMessage('Product type is required')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Product type must be between 1 and 255 characters'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: MIN_REQUIREMENT_QUANTITY })
    .withMessage(`Quantity must be at least ${MIN_REQUIREMENT_QUANTITY}`),
  body('requirement_text')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Requirement text must not exceed 5000 characters'),
  body('product_link')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: false, allow_underscores: true })
    .withMessage('Product link must be a valid URL'),
  body('image_url')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: false, allow_underscores: true })
    .withMessage('Image URL must be a valid URL'),
  body('notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must not exceed 2000 characters')
];

const validateUpdateRequirement = [
  body('requirement_text')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 5000 })
    .withMessage('Requirement text must not exceed 5000 characters'),
  body('quantity')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === '') return true;
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < MIN_REQUIREMENT_QUANTITY) {
        throw new Error(`Quantity must be at least ${MIN_REQUIREMENT_QUANTITY}`);
      }
      return true;
    }),
  body('product_type')
    .optional({ nullable: true })
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Product type must be between 1 and 255 characters'),
  body('product_link')
    .optional({ nullable: true, checkFalsy: true })
    .isURL({ require_protocol: false, allow_underscores: true })
    .withMessage('Product link must be a valid URL'),
  body('image_url')
    .optional({ nullable: true, checkFalsy: true })
    .isURL({ require_protocol: false, allow_underscores: true })
    .withMessage('Image URL must be a valid URL'),
  body('notes')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Notes must not exceed 2000 characters')
];

const validateCreateRequirementResponse = [
  body('quoted_price')
    .notEmpty()
    .withMessage('quoted_price is required')
    .isFloat({ gt: 0 })
    .withMessage('quoted_price must be a positive number'),
  body('price_per_unit')
    .notEmpty()
    .withMessage('price_per_unit is required')
    .isFloat({ gt: 0 })
    .withMessage('price_per_unit must be a positive number'),
  body('delivery_time')
    .notEmpty()
    .withMessage('delivery_time is required')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('delivery_time must be between 1 and 255 characters'),
  body('notes')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 2000 })
    .withMessage('notes must not exceed 2000 characters')
];

// POST /api/requirements - Create requirement (Buyer only)
router.post('/', authenticateToken, validateCreateRequirement, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorsArray = errors.array();
      const firstMsg = errorsArray[0]?.msg || errorsArray[0]?.message;
      return res.status(400).json({
        success: false,
        message: firstMsg ? `Validation failed: ${firstMsg}` : 'Validation failed',
        errors: errorsArray
      });
    }

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can create requirements'
      });
    }

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;

    // At this point, validation has ensured product_type and quantity are present and valid
    const requirementData = {
      buyer_id: req.user.userId,
      product_type: product_type.trim(), // Required - validated
      quantity: parseInt(quantity, 10), // Required - validated as minimum quantity integer
      requirement_text: requirement_text && requirement_text.trim().length > 0 ? requirement_text.trim() : null,
      product_link: product_link && product_link.trim().length > 0 ? product_link.trim() : null,
      image_url: image_url && image_url.trim().length > 0 ? image_url.trim() : null,
      notes: notes && notes.trim().length > 0 ? notes.trim() : null,
      status: 'pending'
    };

    const requirement = await databaseService.createRequirement(requirementData);

    // Return response immediately - notifications processed in background
    res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      data: requirement
    });

    // Process notifications asynchronously (fire and forget)
    notifyAsync(async () => {
      try {
        const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
        const enrichedRequirement = { ...requirement, buyer: buyer || null };

        const verifiedManufacturers = await databaseService.getAllManufacturers({ verified: true, limit: 100 });
        const io = req.app.locals.io;
        
        // Send socket notifications to verified manufacturers (non-blocking)
        if (io && verifiedManufacturers.length > 0) {
          verifiedManufacturers.forEach(manufacturer => {
            io.to(`user:${manufacturer.id}`).emit('requirement:new', { requirement: enrichedRequirement });
          });
        }

        // Send WhatsApp notifications in parallel batches to avoid rate limiting
        if (verifiedManufacturers.length > 0) {
          const BATCH_SIZE = 10; // Process 10 notifications in parallel
          const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

          for (let i = 0; i < verifiedManufacturers.length; i += BATCH_SIZE) {
            const batch = verifiedManufacturers.slice(i, i + BATCH_SIZE);
            
            // Process batch in parallel
            await Promise.allSettled(
              batch.map(async (manufacturer) => {
                if (manufacturer.phone_number) {
                  try {
                    await whatsappService.notifyNewRequirement(manufacturer.phone_number, requirement);
                  } catch (error) {
                    console.error(`Failed to notify manufacturer ${manufacturer.id}:`, error.message);
                  }
                }
              })
            );

            // Add delay between batches to respect rate limits (except for last batch)
            if (i + BATCH_SIZE < verifiedManufacturers.length) {
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
          }
        }
      } catch (error) {
        console.error('Background notification error:', error.message);
      }
    }, 'Background requirement notification');
  } catch (error) {
    console.error('Create requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create requirement',
      error: error.message
    });
  }
});

// GET /api/requirements
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const options = {
      limit,
      offset,
      sortBy,
      sortOrder
    };

    let requirements;

    if (req.user.role === 'buyer') {
      requirements = await databaseService.getBuyerRequirements(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      requirements = await databaseService.getAllRequirements(options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    return res.status(200).json({
      success: true,
      data: requirements,
      count: requirements.length
    });
  } catch (error) {
    console.error('Get requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      error: error.message
    });
  }
});

// GET /api/requirements/buyer/statistics (Buyer only)
// Note: Must come before /:id
router.get('/buyer/statistics', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can access requirement statistics'
      });
    }

    const statistics = await databaseService.getBuyerRequirementStatistics(req.user.userId);

    return res.status(200).json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Get buyer requirement statistics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement statistics',
      error: error.message
    });
  }
});

// GET /api/requirements/conversation/:conversationId/active-requirements
// All requirements for this buyer-manufacturer pair (chat requirement tabs, no status filter)
// Note: Must come before /:id
router.get('/conversation/:conversationId/active-requirements', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await databaseService.getConversation(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const { userId, role } = req.user;
    if (!((role === 'buyer' && conversation.buyer_id === userId) || 
          (role === 'manufacturer' && conversation.manufacturer_id === userId))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view requirements for this conversation'
      });
    }

    const requirements = await databaseService.getActiveRequirementsForConversation(
      conversation.buyer_id,
      conversation.manufacturer_id
    );

    return res.status(200).json({
      success: true,
      data: requirements,
      count: requirements.length
    });
  } catch (error) {
    console.error('Get active requirements for conversation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active requirements',
      error: error.message
    });
  }
});

// GET /api/requirements/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const requirement = await databaseService.getRequirementWithBuyer(id);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this requirement'
      });
    }

    // Buyer data is already included from the relationship query
    const enrichedRequirement = {
      ...requirement,
      buyer: requirement.buyer || null
    };

    return res.status(200).json({
      success: true,
      data: enrichedRequirement
    });
  } catch (error) {
    console.error('Get requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement',
      error: error.message
    });
  }
});

// PUT /api/requirements/:id (Buyer only)
router.put('/:id', authenticateToken, validateUpdateRequirement, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this requirement'
      });
    }

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;

    const updateData = {};
    if (requirement_text !== undefined) {
      updateData.requirement_text = requirement_text && requirement_text.trim().length > 0 ? requirement_text.trim() : null;
    }
    if (quantity !== undefined) {
      if (quantity === null || quantity === '') {
        updateData.quantity = null;
      } else {
        const parsedQuantity = parseInt(quantity, 10);
        if (Number.isNaN(parsedQuantity) || parsedQuantity < MIN_REQUIREMENT_QUANTITY) {
          return res.status(400).json({
            success: false,
            message: `Quantity must be at least ${MIN_REQUIREMENT_QUANTITY}`
          });
        }
        updateData.quantity = parsedQuantity;
      }
    }
    if (product_type !== undefined) updateData.product_type = product_type ? product_type.trim() : null;
    if (product_link !== undefined) updateData.product_link = product_link ? product_link.trim() : null;
    if (image_url !== undefined) updateData.image_url = image_url ? image_url.trim() : null;
    if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;

    const updatedRequirement = await databaseService.updateRequirement(id, updateData);

    return res.status(200).json({
      success: true,
      message: 'Requirement updated successfully',
      data: updatedRequirement
    });
  } catch (error) {
    console.error('Update requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update requirement',
      error: error.message
    });
  }
});

// DELETE /api/requirements/:id (Buyer only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this requirement'
      });
    }

    await databaseService.deleteRequirement(id);

    return res.status(200).json({
      success: true,
      message: 'Requirement deleted successfully'
    });
  } catch (error) {
    console.error('Delete requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete requirement',
      error: error.message
    });
  }
});

// POST /api/requirements/:id/responses - Create response (Manufacturer only)
router.post('/:id/responses', authenticateToken, validateCreateRequirementResponse, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can respond to requirements'
      });
    }

    const { id: requirementId } = req.params;
    const { quoted_price, price_per_unit, delivery_time, notes } = req.body;

    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    const existingResponse = await databaseService.getManufacturerResponse(requirementId, req.user.userId);
    if (existingResponse) {
      return res.status(400).json({
        success: false,
        message: 'You have already responded to this requirement'
      });
    }

    const responseData = {
      requirement_id: requirementId,
      manufacturer_id: req.user.userId,
      quoted_price: parseFloat(quoted_price),
      price_per_unit: parseFloat(price_per_unit),
      delivery_time: delivery_time.trim(),
      notes: notes ? notes.trim() : null,
      status: 'submitted'
    };

    const response = await databaseService.createRequirementResponse(responseData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    
    const enrichedResponse = {
      ...response,
      requirement: { ...requirement, buyer_id: requirement.buyer_id },
      manufacturer: manufacturer || null
    };

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${requirement.buyer_id}`).emit('requirement:response:new', { response: enrichedResponse });
    }

    notifyAsync(async () => {
      const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
      if (buyer && buyer.phone_number) {
        await whatsappService.notifyNewRequirementResponse(buyer.phone_number, response, manufacturer);
      }
    }, 'WhatsApp notification (new requirement response)');

    return res.status(201).json({
      success: true,
      message: 'Response submitted successfully',
      data: response
    });
  } catch (error) {
    console.error('Create requirement response error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit response',
      error: error.message
    });
  }
});

// GET /api/requirements/responses/my-responses (Manufacturer only)
// Note: Must come before /:id/responses
router.get('/responses/my-responses', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can access this endpoint'
      });
    }

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const options = {
      status: req.query.status,
      limit,
      offset,
      sortBy,
      sortOrder
    };

    const responses = await databaseService.getManufacturerResponses(req.user.userId, options);

    return res.status(200).json({
      success: true,
      data: responses,
      count: responses.length
    });
  } catch (error) {
    console.error('Get manufacturer responses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch responses',
      error: error.message
    });
  }
});

// GET /api/requirements/:id/responses
router.get('/:id/responses', authenticateToken, async (req, res) => {
  try {
    const { id: requirementId } = req.params;

    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view these responses'
      });
    }

    const responses = await databaseService.getRequirementResponses(requirementId);

    return res.status(200).json({
      success: true,
      data: responses,
      count: responses.length
    });
  } catch (error) {
    console.error('Get requirement responses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch responses',
      error: error.message
    });
  }
});

// GET /api/requirements/responses/:responseId
router.get('/responses/:responseId', authenticateToken, async (req, res) => {
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
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this response'
      });
    }

    if (req.user.role === 'manufacturer' && response.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this response'
      });
    }

    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const enrichedResponse = {
      ...response,
      requirement: { ...requirement, buyer: buyer || null },
      manufacturer: manufacturer || null
    };

    return res.status(200).json({
      success: true,
      data: enrichedResponse
    });
  } catch (error) {
    console.error('Get requirement response error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch response',
      error: error.message
    });
  }
});

// PATCH /api/requirements/responses/:responseId/status (Buyer only)
router.patch('/responses/:responseId/status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can update response status'
      });
    }

    const { responseId } = req.params;
    const { status } = req.body;

    if (!status || !['rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be "rejected". Use Accept & Pay flow for acceptance.'
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
        message: 'You do not have permission to update this response'
      });
    }

    const updateData = { status };

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    await databaseService.updateRequirement(response.requirement_id, { status: 'rejected' });
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const enrichedResponse = {
      ...updatedResponse,
      requirement: { ...requirement, buyer: buyer || null },
      manufacturer: manufacturer || null
    };

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('requirement:response:status:updated', { 
        response: enrichedResponse,
        status: status
      });
    }

    notifyAsync(async () => {
      if (manufacturer && manufacturer.phone_number) {
        await whatsappService.notifyResponseStatusUpdate(manufacturer.phone_number, status, requirement);
      }
    }, 'WhatsApp notification (response status update)');

    return res.status(200).json({
      success: true,
      message: `Response ${status} successfully`,
      data: updatedResponse
    });
  } catch (error) {
    console.error('Update response status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update response status',
      error: error.message
    });
  }
});

// GET /api/requirements/admin/orders (Admin only)
router.get('/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const options = {
      sortBy,
      sortOrder
    };

    // Fetch all requirements (acts as orders for admin view)
    const orders = await databaseService.getAllRequirements(options);

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

module.exports = router;
