const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const socketAuth = require('./middleware/wsAuth');
const databaseService = require('./services/databaseService');
const { buildMessageSummary } = require('./utils/messageSummary');
const supabase = require('./config/supabase');

// Import routes
const authRoutes = require('./routes/auth');
const manufacturerRoutes = require('./routes/manufacturers');
const buyerRoutes = require('./routes/buyers');
const chatRoutes = require('./routes/chat');
const uploadRoutes = require('./routes/upload');
const requirementsRoutes = require('./routes/requirements');
const aiDesignsRoutes = require('./routes/aiDesigns');
const aiDesignResponsesRoutes = require('./routes/aiDesignResponses');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

// Default allowed origins for production (if not specified in env)
const defaultOrigins = [
  'https://grupo.in',
  'https://www.grupo.in',
  'http://localhost:3000'
];

// Combine env origins with defaults (env takes precedence, but defaults are included if env is empty)
const allAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins;

app.use(cors({ 
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin requests)
    if (!origin) {
      return cb(null, true);
    }
    
    // Check if origin is in allowed list
    if (allAllowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    
    // Reject if origin is not allowed
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    cb(new Error('Not allowed by CORS'));
  }, 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
}));

// Compression middleware - Optimized for performance
app.use(compression({
  filter: (req, res) => {
    // Don't compress if client explicitly requests no compression
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use default filter (compresses text/html, text/css, application/json, etc.)
    return compression.filter(req, res);
  },
  level: 6, // Balance between speed and compression (1-9, 6 is optimal)
  threshold: 1024, // Only compress responses > 1KB (small responses don't benefit)
  // Compress JSON responses (our main response type)
  // Default filter already includes application/json, but we ensure it's enabled
}));

// Logging middleware
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Groupo Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/manufacturers', manufacturerRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/ai-designs', aiDesignsRoutes);
app.use('/api/ai-design-responses', aiDesignResponsesRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Groupo Backend API! 🚀',
    version: '1.0.0',
    description: 'One-Stop AI Manufacturing Platform Backend',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      manufacturers: '/api/manufacturers',
      buyers: '/api/buyers',
      chat: '/api/chat',
      requirements: '/api/requirements',
      aiDesigns: '/api/ai-designs',
      aiDesignResponses: '/api/ai-design-responses',
      upload: '/api/upload',
      health: '/health'
    }
  });
});

// HTTP server + Socket.IO
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allAllowedOrigins,
    credentials: true
  },
  path: process.env.WS_PATH || '/socket.io'
});

// Presence tracking (simple in-memory)
const onlineCounts = new Map(); // userId -> connection count

io.use(socketAuth);

// Pass io instance to routes for real-time updates
requirementsRoutes.setIo(io);
aiDesignsRoutes.setIo(io);
aiDesignResponsesRoutes.setIo(io);

io.on('connection', async (socket) => {
  try {
    const { userId, role } = socket.user;

    // Join user-specific room only (role rooms not used, removed for efficiency)
    socket.join(`user:${userId}`);

    // Presence increment
    const previousCount = onlineCounts.get(userId) || 0;
    onlineCounts.set(userId, previousCount + 1);
    
    // Only emit presence to the user themselves (not all users)
    // This reduces unnecessary WebSocket messages
    socket.emit('presence', { userId, online: true });

    // message:send
    socket.on('message:send', async ({ conversationId, body, clientTempId, attachments, requirementId, aiDesignId }) => {
      try {
        if (!conversationId) return;
        
        // Either body or attachments must be present
        const hasBody = body && typeof body === 'string' && body.trim().length > 0;
        const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
        
        if (!hasBody && !hasAttachments) return;
        
        const convo = await databaseService.getConversation(conversationId);
        if (!convo) return;
        const isParticipant = (role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId);
        if (!isParticipant) return;

        const sanitized = hasBody ? (typeof body === 'string' ? body.replace(/<[^>]*>/g, '') : '').slice(0, 4000) : '';
        const summaryText = buildMessageSummary(sanitized, hasAttachments ? attachments : []);
        const message = await databaseService.insertMessage(conversationId, role, userId, sanitized, clientTempId || null, summaryText, requirementId || null, aiDesignId || null);

        // Insert attachments if any
        let messageAttachments = [];
        if (hasAttachments) {
          messageAttachments = await databaseService.insertMessageAttachments(message.id, attachments);
        }

        // Add attachments to message object
        const messageWithAttachments = {
          ...message,
          attachments: messageAttachments
        };

        // Refresh conversation summary
        const refreshed = await databaseService.getConversation(conversationId);

        io.to(`user:${convo.buyer_id}`).to(`user:${convo.manufacturer_id}`).emit('message:new', {
          message: messageWithAttachments,
          conversationSummary: {
            id: refreshed.id,
            last_message_at: refreshed.last_message_at,
            last_message_text: refreshed.last_message_text,
            is_archived: refreshed.is_archived
          }
        });
      } catch (err) {
        console.error('WS message:send error:', err);
      }
    });

    // message:read (supports upToMessageId)
    socket.on('message:read', async ({ conversationId, upToMessageId }) => {
      try {
        if (!conversationId) return;
        const convo = await databaseService.getConversation(conversationId);
        if (!convo) return;
        const isParticipant = (role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId);
        if (!isParticipant) return;

        let upTo = new Date().toISOString();
        if (upToMessageId) {
          const { data: msg, error } = await supabase
            .from('messages')
            .select('created_at')
            .eq('id', upToMessageId)
            .single();
          if (!error && msg) upTo = msg.created_at;
        }

        await databaseService.markRead(conversationId, userId, upTo);
        io.to(`user:${convo.buyer_id}`).to(`user:${convo.manufacturer_id}`).emit('message:read', {
          conversationId,
          readerUserId: userId,
          upToMessageId: upToMessageId || null,
          at: upTo
        });
      } catch (err) {
        console.error('WS message:read error:', err);
      }
    });

    socket.on('disconnect', () => {
      const current = onlineCounts.get(userId) || 0;
      if (current <= 1) {
        onlineCounts.delete(userId);
        // Only emit presence to the user themselves (not all users)
        // This reduces unnecessary WebSocket messages
        socket.emit('presence', { userId, online: false });
      } else {
        onlineCounts.set(userId, current - 1);
      }
    });
  } catch (e) {
    console.error('Socket connection error:', e);
    socket.disconnect(true);
  }
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Groupo Backend Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WS path: ${process.env.WS_PATH || '/socket.io'}`);
});

module.exports = { app, io };