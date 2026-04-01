function normalizeSort(input = {}, config = {}) {
  const defaultSortBy = config.defaultSortBy || 'created_at';
  const defaultSortOrder = config.defaultSortOrder || 'desc';
  const allowedSortBy = Array.isArray(config.allowedSortBy) ? config.allowedSortBy : null;

  const requestedSortBy = typeof input.sortBy === 'string' ? input.sortBy.trim() : '';
  const requestedSortOrder = typeof input.sortOrder === 'string' ? input.sortOrder.trim().toLowerCase() : '';

  const sortBy = requestedSortBy || defaultSortBy;
  const safeSortBy = allowedSortBy && allowedSortBy.length > 0 && !allowedSortBy.includes(sortBy)
    ? defaultSortBy
    : sortBy;

  const sortOrder = requestedSortOrder === 'asc' || requestedSortOrder === 'desc'
    ? requestedSortOrder
    : defaultSortOrder;

  return { sortBy: safeSortBy, sortOrder };
}

function applySorting(query, options = {}, config = {}) {
  const { sortBy, sortOrder } = normalizeSort(options, config);
  return query.order(sortBy, { ascending: sortOrder === 'asc' });
}

module.exports = {
  normalizeSort,
  applySorting
};
