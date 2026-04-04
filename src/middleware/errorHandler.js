const errorHandler = (err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    console.error(`[${req.method}] ${req.path} →`, message);
    res.status(status).json({ success: false, message });
  };
  
  module.exports = errorHandler;