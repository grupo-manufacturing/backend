const authService = require('../services/authService');
const databaseService = require('../services/databaseService');
const { ok, fail } = require('../utils/response');
const { isManufacturerOnboardingComplete } = require('../utils/onboardingUtils');

const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD
};

const sendOTP = async (req, res) => {
  try {
    const { phoneNumber, role = 'buyer' } = req.body;
    const result = await authService.sendOTP(phoneNumber, role);
    ok(res, {
      message: 'OTP sent successfully',
      data: { phoneNumber, expiresIn: result.expiresIn, messageSid: result.messageSid }
    });
  } catch (err) {
    fail(res, err.message || 'Failed to send OTP');
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp, role = 'buyer' } = req.body;
    const result = await authService.verifyOTP(phoneNumber, otp, role);
    ok(res, {
      message: 'Authentication successful',
      data: { user: result.user, token: result.token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    });
  } catch (err) {
    fail(res, err.message || 'OTP verification failed');
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.headers.authorization.substring(7);
    const decoded = req.user;

    if (decoded.role !== 'admin') {
      const activeSession = await authService.findActiveSessionByToken(token);
      if (!activeSession || activeSession.profile_id !== decoded.userId || activeSession.profile_type !== decoded.role) {
        return fail(res, 'Token session is inactive or revoked', 401);
      }
    }

    const newToken = authService.generateJWT(decoded.userId, decoded.phoneNumber, decoded.role);
    ok(res, { message: 'Token refreshed successfully', data: { token: newToken, expiresIn: process.env.JWT_EXPIRES_IN || '24h' } });
  } catch {
    fail(res, 'Invalid or expired token', 401);
  }
};

const verifyToken = (req, res) => {
  ok(res, { message: 'Token is valid', data: { user: { phoneNumber: req.user.phoneNumber, verified: true } } });
};

const logout = async (req, res) => {
  try {
    const token = req.headers.authorization.substring(7);
    await authService.logout(token);
    ok(res, { message: 'Logged out successfully' });
  } catch (err) {
    if (err.message === 'Invalid or expired token') return fail(res, err.message, 401);
    fail(res, err.message || 'Logout failed');
  }
};

const adminLogin = async (req, res) => {
  try {
    if (!ADMIN_CREDENTIALS.username || !ADMIN_CREDENTIALS.password) {
      return fail(res, 'Admin credentials not configured', 500);
    }

    const { username, password } = req.body;
    if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
      return fail(res, 'Invalid username or password', 401);
    }

    const token = authService.generateJWT(`admin_${username}`, username, 'admin');
    ok(res, { message: 'Login successful', data: { token, user: { username, role: 'admin' }, expiresIn: process.env.JWT_EXPIRES_IN || '24h' } });
  } catch (err) {
    fail(res, err.message || 'Login failed');
  }
};

const getManufacturerProfile = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can view manufacturer profile', 403);

    const profile = await databaseService.findManufacturerProfileByPhone(req.user.phoneNumber);
    if (!profile) return fail(res, 'Profile not found', 404);

    const fullProfile = await databaseService.findManufacturerProfile(profile.id);
    const normalized = fullProfile || {
      phone_number: profile.phone_number,
      unit_name: '', business_type: '', gst_number: '',
      pan_number: '', msme_number: '', product_types: [], daily_capacity: 0
    };

    ok(res, {
      message: 'Profile retrieved successfully',
      data: { profile: { ...normalized, onboarding_complete: isManufacturerOnboardingComplete(normalized) } }
    });
  } catch (err) {
    fail(res, err.message || 'Failed to get profile');
  }
};

const updateManufacturerProfile = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can update manufacturer profile', 403);

    const profile = await databaseService.findManufacturerProfileByPhone(req.user.phoneNumber);
    if (!profile) return fail(res, 'Profile not found', 404);

    const allowedFields = [
      'unit_name', 'business_type', 'gst_number', 'pan_number',
      'msme_number', 'product_types', 'daily_capacity', 'manufacturing_unit_image_url'
    ];

    const updateData = Object.fromEntries(
      allowedFields.filter(f => f in req.body).map(f => [f, req.body[f]])
    );

    if (Object.keys(updateData).length === 0) {
      return fail(res, 'No allowed fields provided for update');
    }

    const updated = await databaseService.updateManufacturerProfile(profile.id, updateData);
    ok(res, { message: 'Profile updated successfully', data: { profile: updated } });
  } catch (err) {
    if (err.message === 'Invalid or expired token') return fail(res, err.message, 401);
    fail(res, err.message || 'Failed to update profile');
  }
};

const manufacturerOnboarding = async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') return fail(res, 'Only manufacturers can submit onboarding', 403);

    let profile = await databaseService.findManufacturerProfileByPhone(req.user.phoneNumber);
    if (!profile) {
      profile = await databaseService.createManufacturerProfile({
        phone_number: req.user.phoneNumber,
        is_verified: false
      });
    }

    const onboardingData = {
      unit_name: req.body.unit_name,
      business_type: req.body.business_type,
      gst_number: req.body.gst_number,
      pan_number: req.body.pan_number,
      msme_number: req.body.msme_number || null,
      product_types: req.body.product_types || [],
      daily_capacity: req.body.capacity || 0,
      manufacturing_unit_image_url: req.body.manufacturing_unit_image_url || null
    };

    const updated = await databaseService.updateManufacturerProfile(profile.id, onboardingData);
    ok(res, { message: 'Onboarding completed successfully', data: { profile: updated } });
  } catch (err) {
    if (err.message === 'Invalid or expired token') return fail(res, err.message, 401);
    fail(res, err.message || 'Failed to submit onboarding data');
  }
};

const getBuyerProfile = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can view buyer profile', 403);

    const profile = await databaseService.findBuyerProfileByPhone(req.user.phoneNumber);
    if (!profile) return fail(res, 'Profile not found', 404);

    const fullProfile = await databaseService.findBuyerProfile(profile.id);
    ok(res, {
      message: 'Profile retrieved successfully',
      data: {
        profile: fullProfile || {
          full_name: '', email: '',
          phone_number: profile.phone_number,
          business_address: ''
        }
      }
    });
  } catch (err) {
    if (err.message === 'Invalid or expired token') return fail(res, err.message, 401);
    fail(res, err.message || 'Failed to get profile');
  }
};

const updateBuyerProfile = async (req, res) => {
  try {
    if (req.user.role !== 'buyer') return fail(res, 'Only buyers can update buyer profile', 403);

    const profile = await databaseService.findBuyerProfileByPhone(req.user.phoneNumber);
    if (!profile) return fail(res, 'Profile not found', 404);

    const updated = await databaseService.updateBuyerProfile(profile.id, req.body);
    ok(res, { message: 'Profile updated successfully', data: { profile: updated } });
  } catch (err) {
    if (err.message === 'Invalid or expired token') return fail(res, err.message, 401);
    fail(res, err.message || 'Failed to update profile');
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  refreshToken,
  verifyToken,
  logout,
  adminLogin,
  getManufacturerProfile,
  updateManufacturerProfile,
  manufacturerOnboarding,
  getBuyerProfile,
  updateBuyerProfile
};