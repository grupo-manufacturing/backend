const express = require('express');
const { body } = require('express-validator');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { getAll, updateVerification } = require('../controllers/manufacturerController');

const router = express.Router();

router.get('/', authenticateToken, getAll);

router.patch('/:manufacturerId/verified',
  authenticateAdmin,
  [body('verified').isBoolean().withMessage('verified must be a boolean value')],
  validate,
  updateVerification
);

module.exports = router;