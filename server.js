require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

console.log(`[startup] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}`);
console.log(`[startup] DB_PATH=${process.env.DB_PATH || 'not set'}`);
console.log(`[startup] DB_DIR=${process.env.DB_DIR || 'not set'}`);
console.log(`[startup] UPLOADS_DIR=${process.env.UPLOADS_DIR || 'not set'}`);

// Trust Railway's reverse proxy (needed for secure cookies over HTTPS)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Health check — always responds, even if DB init fails
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Ensure data directories exist before anything tries to use them
try {
  const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'db', 'clean-air.db');
  const dbPathDir = path.dirname(dbPath);

  [dbDir, uploadsDir, dbPathDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[startup] Created directory: ${dir}`);
    } else {
      console.log(`[startup] Directory exists: ${dir}`);
    }
  });
} catch (err) {
  console.error('[startup] ERROR creating directories:', err.message);
}

// Initialize database
try {
  const { initDatabase } = require('./db/database');
  initDatabase();
  console.log('[startup] Database initialized successfully');
} catch (err) {
  console.error('[startup] ERROR initializing database:', err.message);
  console.error(err.stack);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
try {
  const SQLiteStore = require('connect-sqlite3')(session);
  app.use(session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: process.env.DB_DIR || path.join(__dirname, 'db')
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT ? true : false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    },
    proxy: process.env.NODE_ENV === 'production' ? true : false
  }));
  console.log('[startup] Session store initialized');
} catch (err) {
  console.error('[startup] ERROR initializing session store:', err.message);
  console.error(err.stack);
  // Fallback to memory sessions
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    }
  }));
  console.log('[startup] Fell back to memory session store');
}

// API routes
try {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/inventory', require('./routes/inventory'));
  app.use('/api/applications', require('./routes/applications'));
  app.use('/api/calculator', require('./routes/calculator'));
  app.use('/api/properties', require('./routes/properties'));
  app.use('/api/ipm', require('./routes/ipm'));
  app.use('/api/purchases', require('./routes/purchases'));
  app.use('/api/audit-log', require('./routes/audit-log'));
  console.log('[startup] All routes loaded');
} catch (err) {
  console.error('[startup] ERROR loading routes:', err.message);
  console.error(err.stack);
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - serve app.html for authenticated routes
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server — this MUST succeed for Railway to see the app as alive
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[startup] Clean Air Treatments running on port ${PORT}`);
});
