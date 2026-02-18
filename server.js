require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy (needed for secure cookies over HTTPS)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Ensure data directories exist before anything tries to use them
const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created data directory: ${dbDir}`);
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`Created uploads directory: ${uploadsDir}`);
}

// Also ensure DB_PATH parent directory exists
const dbPath = process.env.DB_PATH || path.join(__dirname, 'db', 'clean-air.db');
const dbPathDir = path.dirname(dbPath);
if (!fs.existsSync(dbPathDir)) {
  fs.mkdirSync(dbPathDir, { recursive: true });
  console.log(`Created DB path directory: ${dbPathDir}`);
}

// Initialize database
initDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
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

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/calculator', require('./routes/calculator'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/ipm', require('./routes/ipm'));
app.use('/api/audit-log', require('./routes/audit-log'));

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Clean Air Treatments running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});
