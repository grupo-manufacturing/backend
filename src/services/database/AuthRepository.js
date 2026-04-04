const { BaseRepository } = require('./BaseRepository');

class AuthRepository extends BaseRepository {
  async storeOTPSession(otpData) {
    const { data, error } = await this.supabase
      .from('otp_sessions')
      .insert([otpData])
      .select()
      .single();
    if (error) throw new Error(`Failed to store OTP session: ${error.message}`);
    return data;
  }

  async expireActiveOtps(phoneNumber) {
    const { data, error } = await this.supabase
      .from('otp_sessions')
      .update({ expires_at: new Date().toISOString() })
      .eq('phone_number', phoneNumber)
      .eq('is_verified', false)
      .gt('expires_at', new Date().toISOString())
      .select('id');
    if (error) throw new Error(`Failed to expire previous OTPs: ${error.message}`);
    return Array.isArray(data) ? data.length : 0;
  }

  async findOTPSession(phoneNumber) {
    const { data, error } = await this.supabase
      .from('otp_sessions')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find OTP session: ${error.message}`);
    return data || null;
  }

  async updateOTPSession(sessionId, updateData) {
    const { data, error } = await this.supabase
      .from('otp_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update OTP session: ${error.message}`);
    return data;
  }

  async storeUserSession(sessionData) {
    const { data, error } = await this.supabase
      .from('user_sessions')
      .insert([sessionData])
      .select()
      .single();
    if (error) throw new Error(`Failed to store user session: ${error.message}`);
    return data;
  }

  async findUserSession(tokenHash) {
    const { data, error } = await this.supabase
      .from('user_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error && !this.isNotFoundError(error)) throw new Error(`Failed to find user session: ${error.message}`);
    if (!data) return null;

    let profileData = null;
    const table = data.profile_type === 'buyer' ? 'buyer_profiles' : 'manufacturer_profiles';
    const { data: profile, error: profileError } = await this.supabase
      .from(table)
      .select('*')
      .eq('id', data.profile_id)
      .single();

    if (!profileError) profileData = profile;

    return { ...data, profile: profileData };
  }

  async deactivateUserSession(tokenHash) {
    const { data, error } = await this.supabase
      .from('user_sessions')
      .update({ is_active: false })
      .eq('token_hash', tokenHash)
      .select()
      .single();
    if (error) throw new Error(`Failed to deactivate user session: ${error.message}`);
    return data;
  }

  async getDailyOTPCount(phoneNumber) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from('otp_sessions')
      .select('id')
      .eq('phone_number', phoneNumber)
      .gte('created_at', oneDayAgo);
    if (error) throw new Error(`Failed to get daily OTP count: ${error.message}`);
    return data ? data.length : 0;
  }

  async cleanupExpiredOTPs() {
    const { data, error } = await this.supabase.rpc('cleanup_expired_otps');
    if (error) throw new Error(`Failed to cleanup expired OTPs: ${error.message}`);
    return data || 0;
  }

  async cleanupExpiredSessions() {
    const { data, error } = await this.supabase.rpc('cleanup_expired_sessions');
    if (error) throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
    return data || 0;
  }
}

module.exports = new AuthRepository();