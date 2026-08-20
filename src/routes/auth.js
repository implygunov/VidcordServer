import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authenticateToken, JWT_SECRET } from '../middleware/auth.js';

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedUsername.length < 3 || trimmedUsername.length > 24) {
      return res.status(400).json({ error: 'Username must be between 3 and 24 characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check existing
    const existing = db.prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?').get(trimmedUsername, trimmedEmail);
    if (existing) {
      if (existing.username.toLowerCase() === trimmedUsername.toLowerCase()) {
        return res.status(400).json({ error: 'This username is already taken.' });
      }
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const passwordHash = bcrypt.hashSync(password, 10);

    // Default aesthetic avatar based on username initial / gaming style
    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(trimmedUsername)}&backgroundColor=09090b,18181b,27272a`;

    // First user or specific email can be admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const role = userCount === 0 || trimmedEmail.startsWith('admin') ? 'admin' : 'user';
    const badge = role === 'admin' ? 'owner' : 'early_supporter';

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, avatar, bio, custom_status, status, role, badge)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, trimmedUsername, trimmedEmail, passwordHash, defaultAvatar, 'Ready for action on VidCord.', '🎮 Exploring VidCord', 'online', role, badge);

    // Auto-join public servers
    const publicServers = db.prepare('SELECT id FROM servers WHERE is_public = 1').all();
    const insertMember = db.prepare('INSERT OR IGNORE INTO server_members (id, server_id, user_id, role) VALUES (?, ?, ?, ?)');
    for (const s of publicServers) {
      insertMember.run(`mem_${s.id}_${userId}`, s.id, userId, 'member');
    }

    // Log action
    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'USER_REGISTERED',
      `User ${trimmedUsername} registered account.`,
      userId
    );

    const token = jwt.sign({ id: userId, username: trimmedUsername, role }, JWT_SECRET, { expiresIn: '30d' });

    const newUser = db.prepare('SELECT id, username, email, avatar, banner, bio, custom_status, status, role, badge, is_banned, created_at FROM users WHERE id = ?').get(userId);

    res.status(201).json({
      message: 'Registration successful! Welcome to VidCord.',
      token,
      user: newUser
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body; // login can be username or email

    if (!login || !password) {
      return res.status(400).json({ error: 'Please provide your username/email and password.' });
    }

    const trimmedLogin = login.trim();

    const user = db.prepare(`
      SELECT * FROM users 
      WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
    `).get(trimmedLogin, trimmedLogin);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'Your account has been banned from VidCord for violating community guidelines.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    // Update status to online
    db.prepare("UPDATE users SET status = 'online' WHERE id = ?").run(user.id);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      custom_status: user.custom_status,
      status: 'online',
      role: user.role,
      badge: user.badge,
      created_at: user.created_at
    };

    res.json({
      message: 'Welcome back!',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

export default router;
