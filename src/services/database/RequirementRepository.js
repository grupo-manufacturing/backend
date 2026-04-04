const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');
const PAYOUT_RATES = require('../../constants/payoutRates');

class RequirementRepository extends BaseRepository {
  async createRequirement(requirementData) {
    try {
      const { data, error } = await this.supabase
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

  
  async getBuyerRequirements(buyerId, options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = this.supabase
        .from('requirements')
        .select('id, requirement_text, requirement_no, quantity, product_type, image_url, created_at, updated_at, buyer_id, notes, product_link, status')
        .eq('buyer_id', buyerId);

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

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

  
  async getRequirement(requirementId) {
    try {
      const { data, error } = await this.supabase
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

  
  async getRequirementWithBuyer(requirementId) {
    try {
      const { data, error } = await this.supabase
        .from('requirements')
        .select(`
          *,
          buyer:buyer_profiles(id, buyer_identifier, full_name, phone_number, business_address)
        `)
        .eq('id', requirementId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch requirement with buyer: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('RequirementRepository.getRequirementWithBuyer error:', error);
      throw error;
    }
  }

  
  async updateRequirement(requirementId, updateData) {
    try {
      const { data, error } = await this.supabase
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

  
  async deleteRequirement(requirementId) {
    try {
      const { error } = await this.supabase
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

  
  async getBuyerRequirementStatistics(buyerId) {
    try {
      const { count: totalCount, error: totalError } = await this.supabase
        .from('requirements')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', buyerId);

      if (totalError) {
        throw new Error(`Failed to fetch total requirements: ${totalError.message}`);
      }

      const { data: requirements, error: requirementsError } = await this.supabase
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

  
  async getAllRequirements(options = {}) {
    try {
      // Select only fields needed for list view to reduce payload size
      let query = this.supabase
        .from('requirements')
        .select(`
          id, requirement_text, requirement_no, quantity, product_type, image_url, created_at, updated_at, buyer_id, notes, product_link, status,
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        `);

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

      // For admin/manufacturer views we want all recent requirements by default.
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 1000, maxLimit: 1000 });

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

  
  async createRequirementResponse(responseData) {
    try {
      const { data, error } = await this.supabase
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

  
  async getRequirementResponses(requirementId) {
    try {
      const { data, error } = await this.supabase
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

  
  async getManufacturerResponse(requirementId, manufacturerId) {
    try {
      const { data, error } = await this.supabase
        .from('requirement_responses')
        .select('*')
        .eq('requirement_id', requirementId)
        .eq('manufacturer_id', manufacturerId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch manufacturer response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('RequirementRepository.getManufacturerResponse error:', error);
      throw error;
    }
  }

  
  async getRequirementResponseById(responseId) {
    try {
      const { data, error } = await this.supabase
        .from('requirement_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch requirement response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('RequirementRepository.getRequirementResponseById error:', error);
      throw error;
    }
  }

  
  async updateRequirementResponse(responseId, updateData) {
    try {
      const { data, error } = await this.supabase
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

  
  async getManufacturerResponses(manufacturerId, options = {}) {
    try {
      let query = this.supabase
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

      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

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

  
  async getActiveRequirementsForConversation(buyerId, manufacturerId) {
    try {
      const { data: responses, error: responsesError } = await this.supabase
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

  
  async getPendingMilestonePayouts() {
    try {
      const { data: responses, error } = await this.supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(
            id,
            requirement_no,
            product_type,
            quantity,
            buyer_id,
            buyer:buyer_profiles(id, full_name, phone_number, business_address)
          ),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .or('status.eq.accepted,status.eq.milestone_1_done,status.eq.milestone_2_done,status.eq.delivered')
        .order('updated_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch pending milestone payouts: ${error.message}`);
      }

      return (responses || [])
        .filter((r) => {
          if (r.status === 'accepted' && !r.m1_paid_at) return true;
          if (r.status === 'milestone_1_done' && !r.m2_paid_at) return true;
          if (r.status === 'delivered' && !r.final_paid_at) return true;
          return false;
        })
        .map((r) => {
          if (r.status === 'accepted' && !r.m1_paid_at) {
            return {
              ...r,
              pendingMilestone: 'm1',
              payoutAmount: r.quoted_price ? (r.quoted_price * PAYOUT_RATES.M1_NET) : 0,
              payoutLabel: 'M1 Payout (30% - 3% fee = 27%)'
            };
          }
          if (r.status === 'milestone_1_done' && !r.m2_paid_at) {
            return {
              ...r,
              pendingMilestone: 'm2',
              payoutAmount: r.quoted_price ? (r.quoted_price * PAYOUT_RATES.M2_NET) : 0,
              payoutLabel: 'M2 Payout (20% - 2% fee = 18%)'
            };
          }
          return {
            ...r,
            pendingMilestone: 'final',
            payoutAmount: r.quoted_price ? (r.quoted_price * PAYOUT_RATES.FINAL_NET) : 0,
            payoutLabel: 'Final Payout (50% - 5% fee = 45%)'
          };
        });
    } catch (error) {
      console.error('RequirementRepository.getPendingMilestonePayouts error:', error);
      throw error;
    }
  }

  
  async getTotalRevenueFromResponses() {
    try {
      const { data, error } = await this.supabase
        .from('requirement_responses')
        .select('quoted_price');

      if (error) {
        throw new Error(`Failed to fetch requirement responses for revenue: ${error.message}`);
      }

      const total = (data || []).reduce((sum, row) => {
        const value = Number(row.quoted_price) || 0;
        return sum + value;
      }, 0);

      return total;
    } catch (error) {
      console.error('RequirementRepository.getTotalRevenueFromResponses error:', error);
      throw error;
    }
  }

  
  async getTopManufacturerByRevenue() {
    try {
      const { data, error } = await this.supabase
        .from('requirement_responses')
        .select(`
          manufacturer_id,
          status,
          quoted_price,
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `);

      if (error) {
        throw new Error(`Failed to fetch requirement responses for top manufacturer: ${error.message}`);
      }

      const statsByManufacturer = new Map();

      (data || []).forEach((row) => {
        const manufacturerId = row.manufacturer_id;
        if (!manufacturerId) return;

        const key = String(manufacturerId);
        const existing =
          statsByManufacturer.get(key) || {
            name:
              row.manufacturer?.unit_name ||
              row.manufacturer?.manufacturer_id ||
              'Unknown Manufacturer',
            phone: row.manufacturer?.phone_number || '',
            total: 0,
            acceptedCount: 0,
            totalOrdersCount: 0
          };

        const quoted = Number(row.quoted_price) || 0;
        const status = String(row.status || '').toLowerCase();
        // Treat all post-acceptance / in-progress / completed statuses as "accepted-like"
        const isAcceptedLike = !['submitted', 'rejected'].includes(status);

        const updated = {
          name: existing.name,
          phone: existing.phone,
          total: existing.total + quoted,
          acceptedCount: existing.acceptedCount + (isAcceptedLike ? 1 : 0),
          totalOrdersCount: existing.totalOrdersCount + 1
        };

        statsByManufacturer.set(key, updated);
      });

      let top = null;
      statsByManufacturer.forEach((value) => {
        if (!top) {
          top = value;
          return;
        }

        const better =
          value.total > top.total ||
          (value.total === top.total && value.totalOrdersCount > top.totalOrdersCount);

        if (better) {
          top = value;
        }
      });

      return top;
    } catch (error) {
      console.error('RequirementRepository.getTopManufacturerByRevenue error:', error);
      throw error;
    }
  }
}

module.exports = new RequirementRepository();