const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getAll } = require('../controllers/buyerController');

const router = express.Router();

router.get('/', authenticateToken, getAll);

module.exports = router;