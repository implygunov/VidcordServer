import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase } from './db.js';
import { seedData } from './seed.js';
import { setupSocketIO } from './socket/chatHandler.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import serversRoutes from './routes/servers.js';
import messagesRoutes from './routes/messages.js';
import dmsRoutes from './routes/dms.js';
import searchRoutes from './routes/search.js';
import adminRoutes from './routes/admin.js';
import nitroRoutes from './routes/nitro.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Security Middleware: Helmet
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting: general API protection
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', generalLimiter);

// Auth Rate Limiting: brute-force protection
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60, // 60 attempts
  message: { error: 'Too many authentication attempts. Please wait 10 minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads directory
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'VidCord Server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/dms', dmsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nitro', nitroRoutes);

// Real-time Socket.IO initialization
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 15000
});

setupSocketIO(io);

// Initialize DB & initial seed
initDatabase();
seedData();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`⚡ VIDCORD BACKEND ACTIVE ON PORT ${PORT}`);
  console.log(`🛡️  Security headers & rate-limiting enabled`);
  console.log(`🎮 Socket.IO Real-time chat online`);
  console.log(`=========================================`);
});
