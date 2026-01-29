const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const geminiService = require('../services/geminiService');
const { authenticateToken } = require('../middleware/auth');
const { uploadBase64Image } = require('../config/cloudinary');

let io = null;

router.setIo = (socketIo) => {
  io = socketIo;
};

const isBase64Image = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/') || 
         (str.length > 100 && /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, '')));
};

// Validation middleware for creating AI design
const validateCreateAIDesign = [
  body('image_url')
    .notEmpty()
    .withMessage('Image URL is required')
    .trim()
    .custom((value) => {
      // Base64 images can be very long (50k+ characters), so we allow up to 10MB base64
      // Regular URLs should be reasonable length
      if (isBase64Image(value)) {
        // Base64 image - allow up to 10MB (approximately 13.3M characters when base64 encoded)
        if (value.length > 13300000) {
          throw new Error('Image is too large. Maximum size is 10MB.');
        }
      } else {
        // Regular URL - validate as URL and reasonable length
        if (value.length > 5000) {
          throw new Error('Image URL must not exceed 5000 characters');
        }
        // Basic URL validation (can be http, https, or data URI)
        if (!value.match(/^(https?:\/\/|data:image\/)/i)) {
          throw new Error('Image URL must be a valid HTTP/HTTPS URL or data URI');
        }
      }
      return true;
    }),
  body('apparel_type')
    .notEmpty()
    .withMessage('Apparel type is required')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Apparel type must be between 1 and 255 characters'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  body('design_description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Design description must not exceed 5000 characters'),
  body('preferred_colors')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Preferred colors must not exceed 500 characters'),
  body('print_placement')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Print placement must not exceed 500 characters'),
  body('status')
    .optional()
    .isIn(['draft', 'published'])
    .withMessage('Status must be either "draft" or "published"')
];

// POST /api/ai-designs - Create new AI design (Buyer only)
router.post('/', authenticateToken, validateCreateAIDesign, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can publish AI designs'
      });
    }

    const {
      image_url,
      apparel_type,
      design_description,
      quantity,
      preferred_colors,
      print_placement,
      status
    } = req.body;

    const isBase64 = isBase64Image(image_url);
    const initialImageUrl = image_url.trim();

    // Create design immediately with base64 URL (or existing URL)
    // Cloudinary upload will happen in background and update the record
    const aiDesignData = {
      buyer_id: req.user.userId,
      image_url: initialImageUrl, // Store base64 or URL initially
      apparel_type: apparel_type.trim(),
      design_description: design_description ? design_description.trim() : null,
      quantity: parseInt(quantity),
      preferred_colors: preferred_colors ? preferred_colors.trim() : null,
      print_placement: print_placement ? print_placement.trim() : null,
      status: status || 'draft'
    };

    const aiDesign = await databaseService.createAIDesign(aiDesignData);

    // Return response immediately - Cloudinary upload happens in background
    res.status(201).json({
      success: true,
      message: 'AI design published successfully',
      data: aiDesign
    });

    // Upload to Cloudinary asynchronously (fire and forget)
    if (isBase64) {
      (async () => {
        try {
          const uploadResult = await uploadBase64Image(initialImageUrl, {
            folder: `groupo-ai-designs/${req.user.userId}`,
            context: {
              buyer_id: req.user.userId,
              apparel_type: apparel_type.trim(),
              uploaded_via: 'ai-design-generation'
            },
            tags: ['ai-design', 'generated', apparel_type.toLowerCase().replace(/\s+/g, '-')]
          });

          // Update the design record with Cloudinary URL
          await databaseService.updateAIDesign(aiDesign.id, {
            image_url: uploadResult.url
          });

          console.log(`Successfully uploaded AI design ${aiDesign.id} to Cloudinary`);
        } catch (uploadError) {
          console.error(`Failed to upload AI design ${aiDesign.id} to Cloudinary:`, uploadError);
          // Design is already saved with base64 URL, so it's still usable
          // Could optionally set a flag or send notification about upload failure
        }
      })();
    }
  } catch (error) {
    console.error('Create AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to publish AI design',
      error: error.message
    });
  }
});

// Validation middleware for getting AI designs
const validateGetAIDesigns = [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  query('status').optional().isIn(['draft', 'published']),
  query('apparel_type').optional().trim().isLength({ max: 255 }),
  query('include_responses').optional().isIn(['true', 'false'])
];

// GET /api/ai-designs - Get AI designs
router.get('/', authenticateToken, validateGetAIDesigns, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Enforce pagination defaults and maximum limits
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || DEFAULT_LIMIT, 1), // At least 1, default 20
      MAX_LIMIT // Maximum 100
    );
    const offset = Math.max(parseInt(req.query.offset) || 0, 0); // At least 0

    const options = {
      limit,
      offset,
      status: req.query.status,
      apparel_type: req.query.apparel_type
    };

    let aiDesigns;

    if (req.user.role === 'buyer') {
      const buyerOptions = { ...options };
      delete buyerOptions.status;
      aiDesigns = await databaseService.getBuyerAIDesigns(req.user.userId, buyerOptions);
    } else if (req.user.role === 'manufacturer') {
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else if (req.user.role === 'admin') {
      options.includeBuyer = true;
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    if (req.query.include_responses === 'true' && aiDesigns.length > 0) {
      const designIds = aiDesigns.map(design => design.id);
      const responsesMap = await databaseService.getAIDesignResponsesBatch(designIds);
      
      aiDesigns = aiDesigns.map(design => ({
        ...design,
        responses: responsesMap.get(design.id) || []
      }));
    }

    return res.status(200).json({
      success: true,
      data: aiDesigns,
      count: aiDesigns.length
    });
  } catch (error) {
    console.error('Get AI designs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI designs',
      error: error.message
    });
  }
});

// Validation middleware for conversation routes
const validateConversationId = [
  param('conversationId').isUUID().withMessage('Conversation ID must be a valid UUID')
];

// GET /api/ai-designs/conversation/:conversationId/accepted - Get accepted AI designs for conversation
// Note: This route MUST come before /:id to avoid route conflicts
router.get('/conversation/:conversationId/accepted', authenticateToken, validateConversationId, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

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
        message: 'Not authorized to view AI designs for this conversation'
      });
    }

    const aiDesigns = await databaseService.getAcceptedAIDesignsForConversation(
      conversation.buyer_id,
      conversation.manufacturer_id
    );

    return res.status(200).json({
      success: true,
      data: aiDesigns,
      count: aiDesigns.length
    });
  } catch (error) {
    console.error('Get accepted AI designs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch accepted AI designs',
      error: error.message
    });
  }
});

// Validation middleware for generating AI design
const validateGenerateAIDesign = [
  body('apparel_type')
    .notEmpty()
    .withMessage('Apparel type is required')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Apparel type must be between 1 and 255 characters'),
  body('theme_concept')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Theme concept must not exceed 1000 characters'),
  body('print_placement')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Print placement must not exceed 500 characters'),
  body('main_elements')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Main elements must not exceed 1000 characters'),
  body('preferred_colors')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Preferred colors must not exceed 500 characters')
];

// POST /api/ai-designs/generate - Generate AI design using Gemini (Buyer only)
// Note: This route MUST come before /:id to avoid route conflicts
router.post('/generate', authenticateToken, validateGenerateAIDesign, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can generate AI designs'
      });
    }

    const {
      apparel_type,
      theme_concept,
      print_placement,
      main_elements,
      preferred_colors
    } = req.body;

    // Call Gemini service to generate design
    const result = await geminiService.generateDesign({
      apparel_type,
      theme_concept,
      print_placement,
      main_elements,
      preferred_colors
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to generate design',
        details: result.details,
        attemptedModels: result.attemptedModels
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        image: result.image
      }
    });
  } catch (error) {
    console.error('Generate AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate AI design',
      error: error.message
    });
  }
});

// Validation middleware for extracting AI design
const validateExtractAIDesign = [
  body('image_url')
    .notEmpty()
    .withMessage('Image URL is required')
    .trim()
    .custom((value) => {
      // Base64 images can be very long (50k+ characters), so we allow up to 10MB base64
      // Regular URLs should be reasonable length
      if (isBase64Image(value)) {
        // Base64 image - allow up to 10MB (approximately 13.3M characters when base64 encoded)
        if (value.length > 13300000) {
          throw new Error('Image is too large. Maximum size is 10MB.');
        }
      } else {
        // Regular URL - validate as URL and reasonable length
        if (value.length > 5000) {
          throw new Error('Image URL must not exceed 5000 characters');
        }
        // Basic URL validation (can be http, https, or data URI)
        if (!value.match(/^(https?:\/\/|data:image\/)/i)) {
          throw new Error('Image URL must be a valid HTTP/HTTPS URL or data URI');
        }
      }
      return true;
    }),
  body('design_id')
    .optional()
    .isUUID()
    .withMessage('Design ID must be a valid UUID')
];

// POST /api/ai-designs/extract - Extract design pattern from image using Gemini (Buyer only)
// Note: This route MUST come before /:id to avoid route conflicts
router.post('/extract', authenticateToken, validateExtractAIDesign, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can extract designs'
      });
    }

    const { image_url, design_id } = req.body;

    // If design_id is provided, check if pattern_url already exists in database
    if (design_id) {
      try {
        const existingDesign = await databaseService.getAIDesign(design_id);
        
        // Verify the design belongs to the buyer
        if (existingDesign && existingDesign.buyer_id !== req.user.userId) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to extract this design'
          });
        }

        // If pattern_url already exists, return it directly (no extraction needed)
        if (existingDesign && existingDesign.pattern_url) {
          return res.status(200).json({
            success: true,
            data: {
              image_url: existingDesign.pattern_url,
              pattern_url: existingDesign.pattern_url
            }
          });
        }
      } catch (error) {
        // If check fails, continue with extraction
        console.warn('Failed to check for existing pattern URL:', error);
      }
    }

    // Call Gemini service to extract design (processing time varies based on Gemini AI)
    const result = await geminiService.extractDesign({
      imageUrl: image_url.trim()
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to extract design',
        details: result.details,
        attemptedModels: result.attemptedModels
      });
    }

    // Return base64 immediately - Cloudinary upload happens in background
    res.status(200).json({
      success: true,
      data: {
        image_url: result.image,
        isBase64: true
      }
    });

    // Upload to Cloudinary asynchronously (fire and forget)
    (async () => {
      try {
        const uploadResult = await uploadBase64Image(result.image, {
          folder: `groupo-ai-designs/${req.user.userId}/extracted`,
          context: {
            buyer_id: req.user.userId,
            uploaded_via: 'ai-design-extraction',
            ...(design_id ? { design_id } : {})
          },
          tags: ['ai-design', 'extracted', 'pattern']
        });

        // If design_id is provided, save the Cloudinary URL to database
        if (design_id && uploadResult.url) {
          try {
            await databaseService.updateAIDesign(design_id, {
              pattern_url: uploadResult.url
            });
            console.log(`Successfully saved pattern URL for design ${design_id} to database`);
          } catch (updateError) {
            console.warn(`Failed to save pattern URL for design ${design_id} to database:`, updateError);
            // Continue even if database update fails
          }
        }
      } catch (uploadError) {
        console.error('Cloudinary upload error (background):', uploadError);
        // Design is already returned with base64, so extraction is still successful
        // Cloudinary upload failure doesn't affect the user experience
      }
    })();
  } catch (error) {
    console.error('Extract AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to extract AI design',
      error: error.message
    });
  }
});

// Validation middleware for ID parameter
const validateId = [
  param('id').isUUID().withMessage('ID must be a valid UUID')
];

// GET /api/ai-designs/:id - Get single AI design by ID
router.get('/:id', authenticateToken, validateId, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const supabase = require('../config/supabase');
    
    // Fetch AI design with buyer data in a single query using relationship
    const { data: aiDesign, error } = await supabase
      .from('ai_designs')
      .select(`
        *,
        buyer:buyer_profiles(id, buyer_identifier, full_name, phone_number, business_address)
      `)
      .eq('id', id)
      .single();

    if (error || !aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this AI design'
      });
    }

    // Buyer data is already included from the relationship query
    const enrichedAIDesign = {
      ...aiDesign,
      buyer: aiDesign.buyer || null
    };

    return res.status(200).json({
      success: true,
      data: enrichedAIDesign
    });
  } catch (error) {
    console.error('Get AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI design',
      error: error.message
    });
  }
});

// Validation middleware for updating pattern URL
const validateUpdatePattern = [
  param('id').isUUID().withMessage('ID must be a valid UUID'),
  body('pattern_url')
    .notEmpty()
    .withMessage('Pattern URL is required')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Pattern URL must be between 1 and 5000 characters')
];

// PUT /api/ai-designs/:id/pattern - Update pattern URL (any authenticated user can update)
router.put('/:id/pattern', authenticateToken, validateUpdatePattern, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;

    const { pattern_url } = req.body;

    // Verify the design exists
    const aiDesign = await databaseService.getAIDesign(id);
    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // For buyers: verify the design belongs to them
    // For manufacturers: allow update (they might be downloading patterns)
    if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this AI design'
      });
    }

    // Update the pattern URL (only if it doesn't exist yet, or allow overwrite)
    const updatedDesign = await databaseService.updateAIDesign(id, {
      pattern_url: pattern_url.trim()
    });

    return res.status(200).json({
      success: true,
      message: 'Pattern URL updated successfully',
      data: updatedDesign
    });
  } catch (error) {
    console.error('Update pattern URL error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update pattern URL',
      error: error.message
    });
  }
});

// PATCH /api/ai-designs/:id/push - Push AI design to manufacturers (Buyer only)
router.patch('/:id/push', authenticateToken, validateId, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can push AI designs to manufacturers'
      });
    }

    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    if (existingAIDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to push this AI design'
      });
    }

    const updatedDesign = await databaseService.updateAIDesign(id, { status: 'published' });

    // Return response immediately - notifications processed in background
    res.status(200).json({
      success: true,
      message: 'AI design pushed to manufacturers successfully',
      data: updatedDesign
    });

    // Process notifications asynchronously (fire and forget)
    (async () => {
      try {
        const buyer = await databaseService.findBuyerProfile(updatedDesign.buyer_id);
        const enrichedAIDesign = {
          ...updatedDesign,
          buyer: buyer || null
        };

        const verifiedManufacturers = await databaseService.getAllManufacturers({ verified: true });
        
        // Send socket notifications to verified manufacturers (non-blocking)
        if (io && verifiedManufacturers.length > 0) {
          verifiedManufacturers.forEach(manufacturer => {
            io.to(`user:${manufacturer.id}`).emit('ai-design:new', { aiDesign: enrichedAIDesign });
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
                    await whatsappService.notifyNewAIDesign(manufacturer.phone_number, updatedDesign);
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
    })();
  } catch (error) {
    console.error('Push AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to push AI design',
      error: error.message
    });
  }
});

// DELETE /api/ai-designs/:id - Delete AI design (Buyer or Admin)
router.delete('/:id', authenticateToken, validateId, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;

    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = req.user.role === 'buyer' && existingAIDesign.buyer_id === req.user.userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this AI design'
      });
    }

    await databaseService.deleteAIDesign(id);

    return res.status(200).json({
      success: true,
      message: 'AI design deleted successfully'
    });
  } catch (error) {
    console.error('Delete AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete AI design',
      error: error.message
    });
  }
});

module.exports = router;
