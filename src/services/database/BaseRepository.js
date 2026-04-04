const supabase = require('../../config/supabase');
const { normalizePagination } = require('../../utils/paginationHelper');

class BaseRepository {
  constructor() {
    this.supabase = supabase;
  }

  static NOT_FOUND = 'PGRST116';

  isNotFoundError(error) {
    return error && error.code === BaseRepository.NOT_FOUND;
  }

  isUniqueViolation(error) {
    return error && error.code === '23505';
  }

  normalizePagination(options = {}, config = {}) {
    return normalizePagination(options, config);
  }
}

module.exports = { BaseRepository, supabase };