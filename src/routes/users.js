import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Search or list users
router.get('/', authenticateToken, (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    let query = `
      SELECT id, username, avatar, banner, bio, custom_status, status, role, badge, created_at 
      FROM users 
      WHERE is_banned = 0
    `;
    const params = [];

    if (q) {
      query += ` AND LOWER(username) LIKE LOWER(?)`;
      params.push(`%${q}%`);
    }

    query += ` ORDER BY CASE WHEN status = 'online' THEN 1 WHEN status = 'idle' THEN 2 WHEN status = 'dnd' THEN 3 ELSE 4 END, username ASC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const users = db.prepare(query).all(...params);
    res.json({ users });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

// Get specific user profile
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, username, avatar, banner, bio, custom_status, status, role, badge, created_at 
      FROM users 
      WHERE id = ? AND is_banned = 0
    `).get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Mutual servers
    const mutualServers = db.prepare(`
      SELECT s.id, s.name, s.icon 
      FROM servers s
      JOIN server_members sm1 ON s.id = sm1.server_id AND sm1.user_id = ?
      JOIN server_members sm2 ON s.id = sm2.server_id AND sm2.user_id = ?
    `).all(req.user.id, user.id);

    res.json({ user, mutualServers });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to retrieve user profile.' });
  }
});

// Update own profile
router.patch('/profile', authenticateToken, (req, res) => {
  try {
    const { username, bio, custom_status, status, avatar, banner, badge } = req.body;
    const userId = req.user.id;

    const updates = [];
    const params = [];

    if (username !== undefined) {
      const trimmed = username.trim();
      if (trimmed.length < 3 || trimmed.length > 24) {
        return res.status(400).json({ error: 'Username must be between 3 and 24 characters.' });
      }
      // check unique
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(trimmed, userId);
      if (existing) {
        return res.status(400).json({ error: 'Username already in use.' });
      }
      updates.push('username = ?');
      params.push(trimmed);
    }

    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio.substring(0, 300));
    }

    if (custom_status !== undefined) {
      updates.push('custom_status = ?');
      params.push(custom_status.substring(0, 100));
    }

    if (status !== undefined && ['online', 'idle', 'dnd', 'offline'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }

    if (avatar !== undefined) {
      updates.push('avatar = ?');
      params.push(avatar);
    }

    if (banner !== undefined) {
      updates.push('banner = ?');
      params.push(banner);
    }

    if (badge !== undefined && ['member', 'early_supporter', 'pro_gamer', 'admin', 'owner'].includes(badge)) {
      // only admin or owner can give themselves admin/owner badge
      if ((badge === 'admin' || badge === 'owner') && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Cannot set admin badge without admin privileges.' });
      }
      updates.push('badge = ?');
      params.push(badge);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updatedUser = db.prepare(`
      SELECT id, username, email, avatar, banner, bio, custom_status, status, role, badge, created_at 
      FROM users WHERE id = ?
    `).get(userId);

    res.json({ message: 'Profile updated successfully!', user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

export default router;
