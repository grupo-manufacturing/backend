const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  sendOTP, verifyOTP, refreshToken, verifyToken, logout, adminLogin,
  getManufacturerProfile, updateManufacturerProfile, manufacturerOnboarding,
  getBuyerProfile, updateBuyerProfile
} = require('../controllers/authController');

const router = express.Router();

const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many OTP requests from this number, please try again after 15 minutes',
  keyGenerator: (req) => req.body.phoneNumber,
  standardHeaders: false,
  legacyHeaders: false
});

const phoneRules = [
  body('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number')
    .custom((value) => {
      if (!value.startsWith('+')) throw new Error('Phone number must include country code (e.g., +1234567890)');
      return true;
    }),
  body('role').optional().isIn(['buyer', 'manufacturer', 'admin'])
];

const otpRules = [
  body('phoneNumber').isMobilePhone('any'),
  body('otp').isLength({ min: 4, max: 8 }).isNumeric().withMessage('OTP must be 4-8 digits'),
  body('role').optional().isIn(['buyer', 'manufacturer', 'admin'])
];

const manufacturerOnboardingRules = [
  body('unit_name').notEmpty().isLength({ min: 1, max: 255 }),
  body('business_type').notEmpty().isLength({ min: 1, max: 100 }),
  body('gst_number').notEmpty().isLength({ min: 1, max: 20 }),
  body('pan_number').notEmpty().isLength({ min: 1, max: 20 }),
  body('msme_number').optional({ nullable: true, checkFalsy: true }).isLength({ min: 1, max: 50 }),
  body('product_types').isArray({ min: 1 }).withMessage('At least one product type is required'),
  body('capacity').notEmpty().isInt({ min: 1 }).withMessage('Daily capacity must be greater than 0'),
  body('manufacturing_unit_image_url').optional({ nullable: true, checkFalsy: true }).isURL()
];

const manufacturerProfileUpdateRules = [
  body('unit_name').optional().isLength({ min: 1, max: 255 }),
  body('business_type').optional().isLength({ min: 1, max: 100 }),
  body('gst_number').optional().isLength({ min: 1, max: 20 }),
  body('pan_number').optional().isLength({ min: 1, max: 20 }),
  body('msme_number').optional({ nullable: true, checkFalsy: true }).isLength({ min: 1, max: 50 }),
  body('product_types').optional().isArray(),
  body('daily_capacity').optional().isInt({ min: 0 }),
  body('manufacturing_unit_image_url').optional({ nullable: true, checkFalsy: true }).isURL()
];

const buyerProfileRules = [
  body('full_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Full name is required'),
  body('email').notEmpty().isEmail().withMessage('Please provide a valid email address'),
  body('phone_number').optional().isMobilePhone('any'),
  body('business_address').notEmpty().isLength({ min: 1, max: 1000 }).withMessage('Business address is required')
];

const adminLoginRules = [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
];

router.post('/send-otp', otpRateLimiter, phoneRules, validate, sendOTP);
router.post('/verify-otp', otpRules, validate, verifyOTP);
router.post('/refresh-token', authenticateToken, refreshToken);
router.get('/verify-token', authenticateToken, verifyToken);
router.post('/logout', authenticateToken, logout);
router.post('/admin-login', adminLoginRules, validate, adminLogin);

router.get('/manufacturer-profile', authenticateToken, getManufacturerProfile);
router.put('/manufacturer-profile', authenticateToken, manufacturerProfileUpdateRules, validate, updateManufacturerProfile);
router.post('/manufacturer-onboarding', authenticateToken, manufacturerOnboardingRules, validate, manufacturerOnboarding);

router.get('/buyer-profile', authenticateToken, getBuyerProfile);
router.put('/buyer-profile', authenticateToken, buyerProfileRules, validate, updateBuyerProfile);

module.exports = router;