/**
 * Manufacturer Repository - Manufacturer profile management
 */
const { supabase } = require('./BaseRepository');
const { normalizePagination } = require('../../utils/paginationHelper');
const { applySorting } = require('../../utils/queryOptionsHelper');

class ManufacturerRepository {
  /**
   * Create a new manufacturer profile
   * @param {Object} profileData - Manufacturer profile data
   * @returns {Promise<Object>} Created manufacturer profile
   */
  async createManufacturerProfile(profileData) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .insert([profileData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('ManufacturerRepository.createManufacturerProfile error:', error);
      throw error;
    }
  }

  /**
   * Find manufacturer profile by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} Manufacturer profile data or null
   */
  async findManufacturerProfileByPhone(phoneNumber) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to find manufacturer profile: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('ManufacturerRepository.findManufacturerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Update manufacturer profile data by phone
   * @param {string} phoneNumber - Phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated manufacturer profile
   */
  async updateManufacturerProfileByPhone(phoneNumber, updateData) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .update(updateData)
        .eq('phone_number', phoneNumber)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('ManufacturerRepository.updateManufacturerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Find manufacturer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Manufacturer profile data
   */
  async findManufacturerProfile(profileId) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        throw new Error(`Failed to find manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('ManufacturerRepository.findManufacturerProfile error:', error);
      throw error;
    }
  }

  /**
   * Update manufacturer profile
   * @param {string} profileId - Profile ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateManufacturerProfile(profileId, profileData) {
    try {
      // First check if profile exists
      const existingProfile = await this.findManufacturerProfile(profileId);
      
      if (existingProfile) {
        // Update existing profile
        const { data, error } = await supabase
          .from('manufacturer_profiles')
          .update({
            ...profileData,
            updated_at: new Date().toISOString()
          })
          .eq('id', profileId)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to update manufacturer profile: ${error.message}`);
        }

        return data;
      } else {
        throw new Error('Manufacturer profile not found');
      }
    } catch (error) {
      console.error('ManufacturerRepository.updateManufacturerProfile error:', error);
      throw error;
    }
  }

  /**
   * Get all manufacturers
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of manufacturer profiles
   */
  async getAllManufacturers(options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = supabase.from('manufacturer_profiles')
        .select('id, manufacturer_id, unit_name, business_type, phone_number, gst_number, pan_number, product_types, is_verified, created_at');

      // Apply filters if provided
      if (options.verified !== undefined) {
        query = query.eq('is_verified', options.verified);
      }

      if (options.business_type) {
        query = query.eq('business_type', options.business_type);
      }

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      query = query.limit(limit);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch manufacturers: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('ManufacturerRepository.getAllManufacturers error:', error);
      throw error;
    }
  }
}

module.exports = new ManufacturerRepository();

