const express = require('express');
const { body, validationResult } = require('express-validator');
const databaseService = require('../services/databaseService');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');

const router = express.Router();

// GET /api/manufacturers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const options = {
      verified: req.query.verified !== undefined ? req.query.verified === 'true' : undefined,
      business_type: req.query.business_type,
      sortBy,
      sortOrder,
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
