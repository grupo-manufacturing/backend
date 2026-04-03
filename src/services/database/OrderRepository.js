/**
 * Order Repository - Orders management
 */
const { BaseRepository } = require('./BaseRepository');
const { applySorting } = require('../../utils/queryOptionsHelper');

class OrderRepository extends BaseRepository {
  /**
   * Create a new order
   * @param {Object} orderData - Order data (buyer_id, manufacturer_id, design_id, quantity, price_per_unit, total_price)
   * @returns {Promise<Object>} Created order
   */
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

  /**
   * Get orders for a manufacturer
   * @param {string} manufacturerId - Manufacturer ID
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of orders with design and buyer info
   */
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

  /**
   * Get a single order by ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order data
   */
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

  /**
   * Get orders for a buyer
   * @param {string} buyerId - Buyer ID
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of orders with design and manufacturer info
   */
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

  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated order
   */
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

  /**
   * Get requirement-response orders for admin workflows.
   * Note: This queries requirement_responses table, not orders table.
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of requirement-response orders with buyer and manufacturer info
   */
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

  /**
   * @deprecated Use getRequirementResponseOrders for clarity.
   */
  async getOrders(options = {}) {
    return this.getRequirementResponseOrders(options);
  }

  /**
   * Get admin requirement-response orders (clearer alias for getOrders)
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of requirement-response orders
   */
  async getAdminRequirementOrders(options = {}) {
    return this.getRequirementResponseOrders(options);
  }

  /**
   * Get manufacturer orders that are cleared_to_ship.
   * @param {string} manufacturerId - Manufacturer ID
   * @param {Object} options - Query options (sorting, pagination)
   * @returns {Promise<Array>} Ready-to-ship orders
   */
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

