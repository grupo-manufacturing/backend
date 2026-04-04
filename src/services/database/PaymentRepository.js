const { BaseRepository } = require('./BaseRepository');

class PaymentRepository extends BaseRepository {
  
  async createPayment(paymentData) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .insert([paymentData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create payment: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('PaymentRepository.createPayment error:', error);
      throw error;
    }
  }

  
  async getPaymentById(paymentId) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch payment: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('PaymentRepository.getPaymentById error:', error);
      throw error;
    }
  }

  
  async getPaymentWithDetails(paymentId) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .select(`
          *,
          requirement_response:requirement_responses(
            id,
            requirement_id,
            quoted_price,
            price_per_unit,
            delivery_time,
            status,
            requirement:requirements(
              id,
              requirement_no,
              product_type,
              quantity
            )
          ),
          buyer:buyer_profiles(id, full_name, phone_number),
          manufacturer:manufacturer_profiles(id, unit_name, phone_number)
        `)
        .eq('id', paymentId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch payment with details: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('PaymentRepository.getPaymentWithDetails error:', error);
      throw error;
    }
  }

  
  async getPaymentsByResponseId(requirementResponseId) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .select('*')
        .eq('requirement_response_id', requirementResponseId)
        .order('payment_number', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch payments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('PaymentRepository.getPaymentsByResponseId error:', error);
      throw error;
    }
  }

  
  async getPaymentByResponseAndNumber(requirementResponseId, paymentNumber) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .select('*')
        .eq('requirement_response_id', requirementResponseId)
        .eq('payment_number', paymentNumber)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch payment: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('PaymentRepository.getPaymentByResponseAndNumber error:', error);
      throw error;
    }
  }

  
  async getRequirementResponseWithRequirement(requirementResponseId) {
    try {
      const { data, error } = await this.supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(*)
        `)
        .eq('id', requirementResponseId)
        .single();

      if (error && !this.isNotFoundError(error)) {
        throw new Error(`Failed to fetch requirement response with requirement: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('PaymentRepository.getRequirementResponseWithRequirement error:', error);
      throw error;
    }
  }

  
  async updatePayment(paymentId, updateData) {
    try {
      const { data, error } = await this.supabase
        .from('payments')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update payment: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('PaymentRepository.updatePayment error:', error);
      throw error;
    }
  }

  
  async getPendingVerificationPayments(options = {}) {
    try {
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 50, maxLimit: 200 });

      const { data, error } = await this.supabase
        .from('payments')
        .select(`
          *,
          requirement_response:requirement_responses(
            id,
            requirement_id,
            quoted_price,
            status,
            requirement:requirements(
              id,
              requirement_no,
              product_type,
              quantity
            )
          ),
          buyer:buyer_profiles(id, full_name, phone_number, business_address),
          manufacturer:manufacturer_profiles(id, unit_name, phone_number)
        `)
        .eq('status', 'pending_verification')
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error(`Failed to fetch pending payments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('PaymentRepository.getPendingVerificationPayments error:', error);
      throw error;
    }
  }

  
  async getBuyerPayments(buyerId, options = {}) {
    try {
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      let query = this.supabase
        .from('payments')
        .select(`
          *,
          requirement_response:requirement_responses(
            id,
            requirement_id,
            quoted_price,
            status,
            requirement:requirements(id, requirement_no, product_type, quantity)
          ),
          manufacturer:manufacturer_profiles(id, unit_name)
        `)
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (options.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch buyer payments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('PaymentRepository.getBuyerPayments error:', error);
      throw error;
    }
  }

  
  async getManufacturerPayments(manufacturerId, options = {}) {
    try {
      const { limit, offset } = this.normalizePagination(options, { defaultLimit: 20, maxLimit: 100 });

      let query = this.supabase
        .from('payments')
        .select(`
          *,
          requirement_response:requirement_responses(
            id,
            requirement_id,
            quoted_price,
            status,
            requirement:requirements(id, requirement_no, product_type, quantity)
          ),
          buyer:buyer_profiles(id, full_name)
        `)
        .eq('manufacturer_id', manufacturerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (options.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch manufacturer payments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('PaymentRepository.getManufacturerPayments error:', error);
      throw error;
    }
  }
}

module.exports = new PaymentRepository();