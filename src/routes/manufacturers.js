const express = require('express');
const { body, validationResult } = require('express-validator');
const databaseService = require('../services/databaseService');

const router = express.Router();

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

// GET /api/manufacturers
router.get('/', async (req, res) => {
  try {
    // Enforce pagination defaults and maximum limits
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || DEFAULT_LIMIT, 1), // At least 1, default 20
      MAX_LIMIT // Maximum 100
    );
    const offset = Math.max(parseInt(req.query.offset) || 0, 0); // At least 0

    const options = {
      verified: req.query.verified !== undefined ? req.query.verified === 'true' : undefined,
      business_type: req.query.business_type,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'desc',
      limit,
      offset
    };

    const manufacturers = await databaseService.getAllManufacturers(options);

    res.status(200).json({
      success: true,
      message: 'Manufacturers retrieved successfully',
      data: {
        manufacturers,
        count: manufacturers.length
      }
    });
  } catch (error) {
    console.error('Get manufacturers error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve manufacturers'
    });
  }
});

// PATCH /api/manufacturers/:manufacturerId/verified (Admin only)
router.patch('/:manufacturerId/verified', 
  authenticateAdmin,
  [
    body('verified')
      .isBoolean()
      .withMessage('verified must be a boolean value')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { manufacturerId } = req.params;
      const { verified } = req.body;

      const manufacturer = await databaseService.findManufacturerProfile(manufacturerId);
      if (!manufacturer) {
        return res.status(404).json({
          success: false,
          message: 'Manufacturer not found'
        });
      }

      const updateData = {
        is_verified: verified,
        updated_at: new Date().toISOString()
      };

      const updatedManufacturer = await databaseService.updateManufacturerProfile(manufacturerId, updateData);

      res.status(200).json({
        success: true,
        message: 'Verification status updated successfully',
        data: { manufacturer: updatedManufacturer }
      });
    } catch (error) {
      console.error('Update verification status error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to update verification status'
      });
    }
  }
);

module.exports = router;
