require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { corsOptions, allowedOrigins } = require('./config/cors');
const { initSocket } = require('./socket');
const { startCleanupJob } = require('./jobs/cleanup');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const manufacturerRoutes = require('./routes/manufacturers');
const buyerRoutes = require('./routes/buyers');
const chatRoutes = require('./routes/chat');
const uploadRoutes = require('./routes/upload');
const requirementsRoutes = require('./routes/requirements');
const paymentsRoutes = require('./routes/payments');
const milestonesRoutes = require('./routes/milestones');
const ordersRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors(corsOptions));
app.use(compression({
  filter: (req, res) => req.headers['x-no-compression'] ? false : compression.filter(req, res),
  level: 6,
  threshold: 1024
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (req, res) => res.status(200).json({
  status: 'OK',
  message: 'Groupo Backend is running!',
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development'
}));

app.use('/api/auth', authRoutes);
app.use('/api/manufacturers', manufacturerRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/milestones', milestonesRoutes);
app.use('/api/orders', ordersRoutes);

app.get('/', (req, res) => res.json({
  message: 'Welcome to Groupo Backend API!',
  version: '1.0.0',
  timestamp: new Date().toISOString()
}));

app.use(errorHandler);

const httpServer = http.createServer(app);
const io = initSocket(httpServer, allowedOrigins);
app.locals.io = io;

startCleanupJob();

httpServer.listen(PORT, () => {
  console.log(`🚀 Groupo Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WS path: ${process.env.WS_PATH || '/socket.io'}`);
});

module.exports = { app, io };