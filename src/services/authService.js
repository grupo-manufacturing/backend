const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const databaseService = require('./databaseService');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

class AuthService {
  generateOTP(length = parseInt(process.env.OTP_LENGTH) || 6) {
    const digits = '0123456789';
    const buffer = crypto.randomBytes(length);
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[buffer[i] % digits.length];
    }
    return otp;
  }

  async getDailyOTPCount(phoneNumber) {
    try {
      return await databaseService.getDailyOTPCount(phoneNumber);
    } catch {
      return 0;
    }
  }

  async sendOTP(phoneNumber, role = 'buyer') {
    if (!this.isValidPhoneNumber(phoneNumber)) {
      throw new Error('Invalid phone number format');
    }

    const dailyCount = await this.getDailyOTPCount(phoneNumber);
    if (dailyCount >= 3) {
      throw new Error('You have reached the maximum of 3 OTP requests per day. Please try again tomorrow.');
    }

    try {
      await databaseService.expireActiveOtps(phoneNumber);
    } catch (e) {
      console.warn('Could not expire previous OTPs:', e?.message || e);
    }

    const otp = this.generateOTP();
    const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 2) * 60 * 1000);

    await databaseService.storeOTPSession({
      phone_number: phoneNumber,
      otp_code_hash: hash(otp),
      expires_at: expiresAt.toISOString(),
      is_verified: false,
      attempts: 0
    });

    try {
      const message = await twilioClient.messages.create({
        body: `Your Grupo verification code is: ${otp}. This code expires in ${process.env.OTP_EXPIRY_MINUTES || 2} minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });

      console.log(`OTP sent to ${phoneNumber}. SID: ${message.sid}`);
      return { success: true, messageSid: message.sid, expiresIn: process.env.OTP_EXPIRY_MINUTES || 2 };
    } catch (error) {
      const twilioErrors = { 21211: 'Invalid phone number', 21610: 'Phone number is not verified (trial account)', 21408: 'Permission to send SMS denied' };
      throw new Error(twilioErrors[error.code] || `SMS sending failed: ${error.message}`);
    }
  }

  async verifyOTP(phoneNumber, otp, role = 'buyer') {
    const storedOTP = await databaseService.findOTPSession(phoneNumber);

    if (!storedOTP) throw new Error('OTP not found or expired');
    if (new Date() > new Date(storedOTP.expires_at)) throw new Error('OTP has expired');
    if (storedOTP.is_verified) throw new Error('OTP has already been used');
    if (storedOTP.attempts >= 3) throw new Error('Too many failed attempts. Please request a new OTP.');

    if (storedOTP.otp_code_hash !== hash(otp)) {
      await databaseService.updateOTPSession(storedOTP.id, { attempts: storedOTP.attempts + 1 });
      throw new Error('Invalid OTP');
    }

    await databaseService.updateOTPSession(storedOTP.id, { is_verified: true });

    let profile;
    if (role === 'buyer') {
      profile = await databaseService.findBuyerProfileByPhone(phoneNumber);
      if (!profile) profile = await databaseService.createBuyerProfile({ phone_number: phoneNumber });
    } else if (role === 'manufacturer') {
      profile = await databaseService.findManufacturerProfileByPhone(phoneNumber);
      if (!profile) profile = await databaseService.createManufacturerProfile({ phone_number: phoneNumber, is_verified: false });
    } else if (role === 'admin') {
      profile = { id: `admin_${phoneNumber.replace(/\+/g, '')}`, phone_number: phoneNumber, role: 'admin' };
    }

    const token = this.generateJWT(profile.id, phoneNumber, role);

    if (role !== 'admin') {
      await databaseService.storeUserSession({
        profile_id: profile.id,
        profile_type: role,
        token_hash: hash(token),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

    return {
      success: true,
      token,
      user: {
        id: profile.id,
        phoneNumber: profile.phone_number,
        role,
        verified: role === 'manufacturer' ? (profile.is_verified || false) : true
      }
    };
  }

  generateJWT(userId, phoneNumber, role) {
    return jwt.sign(
      { userId, phoneNumber, role, type: 'auth' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
  }

  verifyJWT(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      error.message = 'Invalid or expired token';
      throw error;
    }
  }

  isValidPhoneNumber(phoneNumber) {
    return /^\+[1-9]\d{1,14}$/.test(phoneNumber);
  }

  async logout(token) {
    await databaseService.deactivateUserSession(hash(token));
    return { success: true };
  }

  async findActiveSessionByToken(token) {
    return databaseService.findUserSession(hash(token));
  }

  async cleanupExpiredData() {
    const [otpCount, sessionCount] = await Promise.all([
      databaseService.cleanupExpiredOTPs(),
      databaseService.cleanupExpiredSessions()
    ]);
    console.log(`Cleanup: ${otpCount} OTPs, ${sessionCount} sessions removed`);
    return { expiredOTPs: otpCount, expiredSessions: sessionCount };
  }
}

module.exports = new AuthService();