const express = require('express');
const databaseService = require('../services/databaseService');
const { authenticateToken } = require('../middleware/auth');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');

const router = express.Router();

// GET /api/buyers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const options = {
      sortBy,
      sortOrder,
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
