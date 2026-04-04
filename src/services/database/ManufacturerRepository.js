const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');

class ManufacturerRepository extends BaseRepository {
  async createManufacturerProfile(profileData) {
    const { data, error } = await this.supabase
      .from('manufacturer_profiles')
      .insert([profileData])
      .select()
      .single();
    if (error) throw new Error(`Failed to create manufacturer profile: ${error.message}`);
    return data;
  }

  async findManufacturerProfileByPhone(phoneNumber) {
    const { data, error } = await this.supabase
      .from('manufacturer_profiles')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find manufacturer profile: ${error.message}`);
    return data || null;
  }

  async updateManufacturerProfileByPhone(phoneNumber, updateData) {
    const { data, error } = await this.supabase
      .from('manufacturer_profiles')
      .update(updateData)
      .eq('phone_number', phoneNumber)
      .select()
      .single();
    if (error) throw new Error(`Failed to update manufacturer profile: ${error.message}`);
    return data;
  }

  async findManufacturerProfile(profileId) {
    const { data, error } = await this.supabase
      .from('manufacturer_profiles')
      .select('*')
      .eq('id', profileId)
      .single();
    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find manufacturer profile: ${error.message}`);
    return data;
  }

  async updateManufacturerProfile(profileId, profileData) {
    const { data, error } = await this.supabase
      .from('manufacturer_profiles')
      .update({ ...profileData, updated_at: new Date().toISOString() })
      .eq('id', profileId)
      .select()
      .single();
    if (error) {
      throw new Error(this.isNotFoundError(error) ? 'Manufacturer profile not found' : `Failed to update manufacturer profile: ${error.message}`);
    }
    return data;
  }

  async getAllManufacturers(options = {}) {
    let query = this.supabase
      .from('manufacturer_profiles')
      .select('id, manufacturer_id, unit_name, business_type, phone_number, gst_number, pan_number, product_types, is_verified, created_at');

    if (options.verified !== undefined) query = query.eq('is_verified', options.verified);
    if (options.business_type) query = query.eq('business_type', options.business_type);

    query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });

    const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });
    query = query.limit(limit).range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch manufacturers: ${error.message}`);
    return data || [];
  }
}

module.exports = new ManufacturerRepository();