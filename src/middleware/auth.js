const authService = require('../services/authService');

const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      phoneNumber: decoded.phoneNumber,
      verified: true
    };

    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Invalid admin token.' });
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      phoneNumber: decoded.phoneNumber,
      verified: true
    };

    next();
  } catch {
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = authService.verifyJWT(token);

      req.user = {
        userId: decoded.userId,
        role: decoded.role,
        phoneNumber: decoded.phoneNumber,
        verified: true
      };
    }

    next();
  } catch {
    next();
  }
};

const requireRole = (role) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (req.user.role !== role) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }

  next();
};

const decodeToken = (token) => {
  const decoded = authService.verifyJWT(token);
  return {
    userId: decoded.userId,
    role: decoded.role,
    phoneNumber: decoded.phoneNumber
  };
};

module.exports = {
  authenticateToken,
  authenticateAdmin,
  optionalAuth,
  requireRole,
  decodeToken
};