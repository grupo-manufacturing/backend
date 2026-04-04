const databaseService = require('../services/databaseService');
const { ok, fail } = require('../utils/response');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');

const getAll = async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { sortBy, sortOrder } = normalizeSort(req.query, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const buyers = await databaseService.getAllBuyers({ sortBy, sortOrder, limit, offset });
    ok(res, { data: { buyers, count: buyers.length } });
  } catch (err) {
    fail(res, err.message || 'Failed to retrieve buyers');
  }
};

module.exports = { getAll };