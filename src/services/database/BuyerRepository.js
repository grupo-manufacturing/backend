/**
 * Buyer Repository - Buyer profile management
 */
const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');

class BuyerRepository extends BaseRepository {
  /**
   * Create a new buyer profile
   * @param {Object} profileData - Buyer profile data
   * @returns {Promise<Object>} Created buyer profile
   */
  async createBuyerProfile(profileData) {
    try {
      const { data, error } = await this.supabase
        .from('buyer_profiles')
        .insert([profileData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('BuyerRepository.createBuyerProfile error:', error);
      throw error;
    }
  }

  /**
   * Find buyer profile by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} Buyer profile data or null
   */
  async findBuyerProfileByPhone(phoneNumber) {
    try {
      const { data, error } = await this.supabase
        .from('buyer_profiles')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to find buyer profile: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('BuyerRepository.findBuyerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Update buyer profile data by phone
   * @param {string} phoneNumber - Phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated buyer profile
   */
  async updateBuyerProfileByPhone(phoneNumber, updateData) {
    try {
      const { data, error } = await this.supabase
        .from('buyer_profiles')
        .update(updateData)
        .eq('phone_number', phoneNumber)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('BuyerRepository.updateBuyerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Find buyer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Buyer profile data
   */
  async findBuyerProfile(profileId) {
    try {
      const { data, error } = await this.supabase
        .from('buyer_profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to find buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('BuyerRepository.findBuyerProfile error:', error);
      throw error;
    }
  }

  /**
   * Update buyer profile
   * @param {string} profileId - Profile ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateBuyerProfile(profileId, profileData) {
    try {
      const { data, error } = await this.supabase
        .from('buyer_profiles')
        .update(profileData)
        .eq('id', profileId)
        .select()
        .single();

      if (error) {
        if (this.isNotFoundError(error)) {
          throw new Error('Buyer profile not found');
        }
        throw new Error(`Failed to update buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('BuyerRepository.updateBuyerProfile error:', error);
      throw error;
    }
  }

  /**
   * Get all buyers
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of buyer profiles
   */
  async getAllBuyers(options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = this.supabase.from('buyer_profiles')
        .select('id, buyer_identifier, full_name, phone_number, created_at');

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      query = query.limit(limit);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch buyers: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('BuyerRepository.getAllBuyers error:', error);
      throw error;
    }
  }
}

module.exports = new BuyerRepository();

