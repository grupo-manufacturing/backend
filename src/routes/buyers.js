const express = require('express');
const databaseService = require('../services/databaseService');

const router = express.Router();

// GET /api/buyers
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
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'desc',
      limit,
      offset
    };

    const buyers = await databaseService.getAllBuyers(options);

    res.status(200).json({
      success: true,
      message: 'Buyers retrieved successfully',
      data: {
        buyers,
        count: buyers.length
      }
    });
  } catch (error) {
    console.error('Get buyers error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve buyers'
    });
  }
});

module.exports = router;
