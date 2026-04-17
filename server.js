// server.js
// Pratiksha Technologies - AI Chatbot Backend
// Production-ready Express server

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const chatRouter = require('./routes/chat');
const {
  chatRateLimit,
  sessionRateLimit,
  getCorsOptions,
  securityHeaders,
  requestLogger,
  sanitizeInput
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Core Middleware ───────────────────────────────────────────────────────────
app.use(securityHeaders);
app.use(compression()); // Gzip compression
app.use(cors(getCorsOptions()));
app.use(express.json({ limit: '10kb' })); // Limit request body size
app.use(express.urlencoded({ extended: false }));
app.use(requestLogger);
app.use(sanitizeInput);

// ─── Trust Proxy (for shared hosting behind nginx/apache) ─────────────────────
app.set('trust proxy', 1);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/chat/start', sessionRateLimit);
app.use('/api/chat', chatRateLimit);
app.use('/api/chat', chatRouter);

// ─── Root Health Check ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'Pratiksha Technologies Chatbot API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err.message);
  
  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Pratiksha Technologies - Chatbot API   ║
╠═══════════════════════════════════════════╣
║  Status  : Running ✓                     ║
║  Port    : ${PORT}                           ║
║  Mode    : ${process.env.NODE_ENV || 'development'}                   ║
║  Model   : ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}              ║
╚═══════════════════════════════════════════╝
  `);
  
  // Warn if API key not set
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your-')) {
    console.warn('⚠️  WARNING: OPENAI_API_KEY not configured in .env file!');
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[Server] Graceful shutdown initiated...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

module.exports = app;
