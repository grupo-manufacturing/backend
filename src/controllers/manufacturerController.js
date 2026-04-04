const databaseService = require('../services/databaseService');
const { ok, fail } = require('../utils/response');
const { parsePagination } = require('../utils/paginationHelper');
const { normalizeSort } = require('../utils/queryOptionsHelper');

const getAll = async (req, res) => {
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
    ok(res, { data: { manufacturers, count: manufacturers.length } });
  } catch (err) {
    fail(res, err.message || 'Failed to retrieve manufacturers');
  }
};

const updateVerification = async (req, res) => {
  try {
    const { manufacturerId } = req.params;
    const { verified } = req.body;

    const manufacturer = await databaseService.findManufacturerProfile(manufacturerId);
    if (!manufacturer) return fail(res, 'Manufacturer not found', 404);

    const updated = await databaseService.updateManufacturerProfile(manufacturerId, {
      is_verified: verified,
      updated_at: new Date().toISOString()
    });

    ok(res, { data: { manufacturer: updated } });
  } catch (err) {
    fail(res, err.message || 'Failed to update verification status');
  }
};

module.exports = { getAll, updateVerification };