/**
 * Requirement Repository - Requirements and Requirement Responses management
 */
const { supabase } = require('./BaseRepository');
const { normalizePagination } = require('../../utils/paginationHelper');
const { applySorting } = require('../../utils/queryOptionsHelper');

class RequirementRepository {
  // =============================================
  // REQUIREMENTS METHODS
  // =============================================

  /**
   * Create a new requirement
   * @param {Object} requirementData - Requirement data
   * @returns {Promise<Object>} Created requirement
   */
  async createRequirement(requirementData) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .insert([requirementData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('RequirementRepository.createRequirement error:', error);
      throw error;
    }
  }

  /**
   * Get requirements for a buyer
   * @param {string} buyerId - Buyer profile ID
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of requirements
   */
  async getBuyerRequirements(buyerId, options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = supabase
        .from('requirements')
        .select('id, requirement_text, requirement_no, quantity, product_type, image_url, created_at, updated_at, buyer_id, notes, product_link, status')
        .eq('buyer_id', buyerId);

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      query = query.limit(limit);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch requirements: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('RequirementRepository.getBuyerRequirements error:', error);
      throw error;
    }
  }

  /**
   * Get a single requirement by ID
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<Object>} Requirement data
   */
  async getRequirement(requirementId) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .select('*')
        .eq('id', requirementId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('RequirementRepository.getRequirement error:', error);
      throw error;
    }
  }

  /**
   * Update a requirement
   * @param {string} requirementId - Requirement ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated requirement
   */
  async updateRequirement(requirementId, updateData) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', requirementId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('RequirementRepository.updateRequirement error:', error);
      throw error;
    }
  }

  /**
   * Delete a requirement
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteRequirement(requirementId) {
    try {
      const { error } = await supabase
        .from('requirements')
        .delete()
        .eq('id', requirementId);

      if (error) {
        throw new Error(`Failed to delete requirement: ${error.message}`);
      }

      return true;
    } catch (error) {
      console.error('RequirementRepository.deleteRequirement error:', error);
      throw error;
    }
  }

  /**
   * Get buyer requirement statistics
   * @param {string} buyerId - Buyer ID
   * @returns {Promise<Object>} Statistics object with total, accepted, pending, rejected counts
   */
  async getBuyerRequirementStatistics(buyerId) {
    try {
      const { count: totalCount, error: totalError } = await supabase
        .from('requirements')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', buyerId);

      if (totalError) {
        throw new Error(`Failed to fetch total requirements: ${totalError.message}`);
      }

      const { data: requirements, error: requirementsError } = await supabase
        .from('requirements')
        .select('status')
        .eq('buyer_id', buyerId);

      if (requirementsError) {
        throw new Error(`Failed to fetch requirements: ${requirementsError.message}`);
      }

      let accepted = 0;
      let pending = 0;
      let rejected = 0;

      (requirements || []).forEach(r => {
        const s = (r.status || 'pending').toLowerCase();
        if (s === 'accepted') accepted++;
        else if (s === 'rejected') rejected++;
        else pending++;
      });

      return {
        total: totalCount || 0,
        accepted,
        pending,
        rejected
      };
    } catch (error) {
      console.error('RequirementRepository.getBuyerRequirementStatistics error:', error);
      throw error;
    }
  }

  /**
   * Get all requirements (for manufacturers to view)
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of requirements with buyer info
   */
  async getAllRequirements(options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = supabase
        .from('requirements')
        .select(`
          id, requirement_text, requirement_no, quantity, product_type, image_url, created_at, updated_at, buyer_id, notes, product_link, status,
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        `);

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = normalizePagination(options, { defaultLimit: 20, maxLimit: 200 });

      query = query.limit(limit);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch all requirements: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('RequirementRepository.getAllRequirements error:', error);
      throw error;
    }
  }

  // =============================================
  // REQUIREMENT RESPONSES METHODS
  // =============================================

  /**
   * Create a requirement response (manufacturer responds to a requirement)
   * @param {Object} responseData - Response data
   * @returns {Promise<Object>} Created response
   */
  async createRequirementResponse(responseData) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .insert([responseData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create requirement response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('RequirementRepository.createRequirementResponse error:', error);
      throw error;
    }
  }

  /**
   * Get responses for a specific requirement
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<Array>} Array of responses
   */
  async getRequirementResponses(requirementId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select(`
          *,
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, business_type)
        `)
        .eq('requirement_id', requirementId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch requirement responses: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('RequirementRepository.getRequirementResponses error:', error);
      throw error;
    }
  }

  /**
   * Get manufacturer's response to a specific requirement
   * @param {string} requirementId - Requirement ID
   * @param {string} manufacturerId - Manufacturer ID
   * @returns {Promise<Object|null>} Response or null
   */
  async getManufacturerResponse(requirementId, manufacturerId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select('*')
        .eq('requirement_id', requirementId)
        .eq('manufacturer_id', manufacturerId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch manufacturer response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('RequirementRepository.getManufacturerResponse error:', error);
      throw error;
    }
  }

  /**
   * Get a requirement response by ID
   * @param {string} responseId - Response ID
   * @returns {Promise<Object|null>} Response object or null
   */
  async getRequirementResponseById(responseId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch requirement response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('RequirementRepository.getRequirementResponseById error:', error);
      throw error;
    }
  }

  /**
   * Update a requirement response
   * @param {string} responseId - Response ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated response
   */
  async updateRequirementResponse(responseId, updateData) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', responseId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update requirement response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('RequirementRepository.updateRequirementResponse error:', error);
      throw error;
    }
  }

  /**
   * Get all responses from a manufacturer
   * @param {string} manufacturerId - Manufacturer ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of responses with requirement info
   */
  async getManufacturerResponses(manufacturerId, options = {}) {
    try {
      let query = supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(id, requirement_text, quantity, product_type, created_at, buyer_id)
        `)
        .eq('manufacturer_id', manufacturerId);

      // Apply filters
      if (options.status) {
        query = query.eq('status', options.status);
      }

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      query = query.limit(limit);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch manufacturer responses: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('RequirementRepository.getManufacturerResponses error:', error);
      throw error;
    }
  }

  /**
   * Get all requirement threads for chat for a buyer-manufacturer pair.
   * No status filtering is applied.
   * @param {string} buyerId - Buyer ID from conversation
   * @param {string} manufacturerId - Manufacturer ID from conversation
   * @returns {Promise<Array>} Array of requirements with their details
   */
  async getActiveRequirementsForConversation(buyerId, manufacturerId) {
    try {
      const { data: responses, error: responsesError } = await supabase
        .from('requirement_responses')
        .select(`
          requirement_id,
          requirement:requirements(
            id,
            requirement_no,
            requirement_text,
            quantity,
            product_type,
            product_link,
            image_url,
            notes,
            created_at,
            updated_at,
            buyer_id
          )
        `)
        .eq('manufacturer_id', manufacturerId);

      if (responsesError) {
        throw new Error(`Failed to fetch active requirement responses: ${responsesError.message}`);
      }

      // Filter to only include requirements where buyer_id matches the conversation's buyer_id
      const requirements = (responses || [])
        .map(item => item.requirement)
        .filter(req => req && req.buyer_id === buyerId);

      // Sort by created_at descending (newest first)
      requirements.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      return requirements;
    } catch (error) {
      console.error('RequirementRepository.getActiveRequirementsForConversation error:', error);
      throw error;
    }
  }
}

module.exports = new RequirementRepository();

