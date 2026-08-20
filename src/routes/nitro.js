import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Subscribe to VidCord Nitro
router.post('/subscribe', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    
    // Update user to Nitro status
    db.prepare('UPDATE users SET is_nitro = 1, badge = ? WHERE id = ?').run(
      req.user.role === 'admin' ? 'owner' : 'pro_gamer',
      userId
    );

    // Record audit log
    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_nitro_' + Date.now(),
      'NITRO_ACTIVATED',
      `User ${req.user.username} activated VidCord Nitro subscription.`,
      userId
    );

    const updatedUser = db.prepare('SELECT id, username, email, avatar, banner, bio, custom_status, status, role, badge, is_nitro, created_at FROM users WHERE id = ?').get(userId);

    res.json({
      message: 'VidCord Nitro activated! HD 1080p 60fps streaming & neon badges unlocked.',
      user: updatedUser
    });
  } catch (error) {
    console.error('Nitro subscribe error:', error);
    res.status(500).json({ error: 'Failed to activate Nitro.' });
  }
});

// Boost a server
router.post('/boost/:serverId', authenticateToken, (req, res) => {
  try {
    const { serverId } = req.params;
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

    if (!server) {
      return res.status(404).json({ error: 'Server not found.' });
    }

    db.prepare('UPDATE servers SET boost_count = boost_count + 1 WHERE id = ?').run(serverId);

    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_boost_' + Date.now(),
      'SERVER_BOOSTED',
      `User ${req.user.username} boosted community "${server.name}".`,
      req.user.id
    );

    const updatedServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

    res.json({
      message: `Successfully boosted ${server.name}!`,
      server: updatedServer
    });
  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({ error: 'Failed to boost server.' });
  }
});

export default router;
