const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');

class BuyerRepository extends BaseRepository {
  async createBuyerProfile(profileData) {
    const { data, error } = await this.supabase
      .from('buyer_profiles')
      .insert([profileData])
      .select()
      .single();
    if (error) throw new Error(`Failed to create buyer profile: ${error.message}`);
    return data;
  }

  async findBuyerProfileByPhone(phoneNumber) {
    const { data, error } = await this.supabase
      .from('buyer_profiles')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find buyer profile: ${error.message}`);
    return data || null;
  }

  async updateBuyerProfileByPhone(phoneNumber, updateData) {
    const { data, error } = await this.supabase
      .from('buyer_profiles')
      .update(updateData)
      .eq('phone_number', phoneNumber)
      .select()
      .single();
    if (error) throw new Error(`Failed to update buyer profile: ${error.message}`);
    return data;
  }

  async findBuyerProfile(profileId) {
    const { data, error } = await this.supabase
      .from('buyer_profiles')
      .select('*')
      .eq('id', profileId)
      .single();
    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find buyer profile: ${error.message}`);
    return data;
  }

  async updateBuyerProfile(profileId, profileData) {
    const { data, error } = await this.supabase
      .from('buyer_profiles')
      .update(profileData)
      .eq('id', profileId)
      .select()
      .single();
    if (error) {
      throw new Error(this.isNotFoundError(error) ? 'Buyer profile not found' : `Failed to update buyer profile: ${error.message}`);
    }
    return data;
  }

  async getAllBuyers(options = {}) {
    let query = this.supabase
      .from('buyer_profiles')
      .select('id, buyer_identifier, full_name, phone_number, created_at');

    query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });
    query = query.limit(limit).range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch buyers: ${error.message}`);
    return data || [];
  }
}

module.exports = new BuyerRepository();