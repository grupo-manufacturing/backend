const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');

class OrderRepository extends BaseRepository {
  
  async createOrder(orderData) {
    try {
      const { data, error } = await this.supabase
        .from('orders')
        .insert([orderData])
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to create order: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('OrderRepository.createOrder error:', error);
      throw error;
    }
  }

  
  async getManufacturerOrders(manufacturerId, options = {}) {
    try {
      let query = this.supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        `)
        .eq('manufacturer_id', manufacturerId);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });
      query = query.limit(limit).range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch manufacturer orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('OrderRepository.getManufacturerOrders error:', error);
      throw error;
    }
  }

  
  async getOrder(orderId) {
    try {
      const { data, error } = await this.supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number, business_address),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .eq('id', orderId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch order: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('OrderRepository.getOrder error:', error);
      throw error;
    }
  }

  
  async getBuyerOrders(buyerId, options = {}) {
    try {
      let query = this.supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number, business_type)
        `)
        .eq('buyer_id', buyerId);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });
      query = query.limit(limit).range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch buyer orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('OrderRepository.getBuyerOrders error:', error);
      throw error;
    }
  }

  
  async updateOrderStatus(orderId, status) {
    try {
      const { data, error } = await this.supabase
        .from('orders')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to update order status: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('OrderRepository.updateOrderStatus error:', error);
      throw error;
    }
  }

  
  async getRequirementResponseOrders(options = {}) {
    try {
      let query = this.supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(
            id,
            requirement_no,
            requirement_text,
            status,
            quantity,
            product_type,
            created_at,
            buyer:buyer_profiles(id, full_name, phone_number, business_address)
          ),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number, business_type)
        `);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      query = applySorting(query, options, { defaultSortBy: 'created_at', defaultSortOrder: 'desc' });
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 50, maxLimit: 200 });
      query = query.limit(limit).range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('OrderRepository.getRequirementResponseOrders error:', error);
      throw error;
    }
  }

  
  async getOrders(options = {}) {
    return this.getRequirementResponseOrders(options);
  }

  
  async getAdminRequirementOrders(options = {}) {
    return this.getRequirementResponseOrders(options);
  }

  
  async getReadyToShipOrders(manufacturerId, options = {}) {
    try {
      let query = this.supabase
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
          )
        `)
        .eq('manufacturer_id', manufacturerId)
        .eq('status', 'cleared_to_ship')
        .order('updated_at', { ascending: false });

      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 50, maxLimit: 200 });
      query = query.limit(limit).range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch ready-to-ship orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('OrderRepository.getReadyToShipOrders error:', error);
      throw error;
    }
  }
}

module.exports = new OrderRepository();