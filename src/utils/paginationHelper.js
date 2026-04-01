function parsePagination(query = {}, options = {}) {
  const defaultLimit = Number.isFinite(options.defaultLimit) ? options.defaultLimit : 20;
  const maxLimit = Number.isFinite(options.maxLimit) ? options.maxLimit : 100;
  const minLimit = Number.isFinite(options.minLimit) ? options.minLimit : 1;

  const rawLimit = parseInt(query.limit, 10);
  const rawOffset = parseInt(query.offset, 10);

  const limit = Math.min(
    Math.max(Number.isNaN(rawLimit) ? defaultLimit : rawLimit, minLimit),
    maxLimit
  );
  const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

  return { limit, offset };
}

function normalizePagination(options = {}, config = {}) {
  const defaultLimit = Number.isFinite(config.defaultLimit) ? config.defaultLimit : 20;
  const maxLimit = Number.isFinite(config.maxLimit) ? config.maxLimit : 100;
  const minLimit = Number.isFinite(config.minLimit) ? config.minLimit : 1;

  const rawLimit = Number(options.limit);
  const rawOffset = Number(options.offset);

  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, minLimit),
    maxLimit
  );
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  return { limit, offset };
}

module.exports = {
  parsePagination,
  normalizePagination
};
