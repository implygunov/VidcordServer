import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const { q = '', serverId, channelId } = req.query;
    const cleanQuery = q.trim();

    if (!cleanQuery || cleanQuery.length < 2) {
      return res.json({
        messages: [],
        channels: [],
        servers: [],
        users: []
      });
    }

    const pattern = `%${cleanQuery}%`;

    // 1. Search Messages
    let messageQuery = `
      SELECT m.id, m.content, m.created_at, m.channel_id, m.server_id,
             u.username, u.avatar, c.name as channel_name, s.name as server_name
      FROM messages m
      JOIN users u ON m.user_id = u.id
      JOIN channels c ON m.channel_id = c.id
      JOIN servers s ON m.server_id = s.id
      JOIN server_members sm ON s.id = sm.server_id AND sm.user_id = ?
      WHERE LOWER(m.content) LIKE LOWER(?)
    `;
    const messageParams = [req.user.id, pattern];

    if (serverId) {
      messageQuery += ` AND m.server_id = ?`;
      messageParams.push(serverId);
    }
    if (channelId) {
      messageQuery += ` AND m.channel_id = ?`;
      messageParams.push(channelId);
    }

    messageQuery += ` ORDER BY m.created_at DESC LIMIT 20`;
    const messages = db.prepare(messageQuery).all(...messageParams);

    // 2. Search Channels
    const channels = db.prepare(`
      SELECT c.id, c.name, c.type, c.category, c.topic, c.server_id, s.name as server_name
      FROM channels c
      JOIN servers s ON c.server_id = s.id
      JOIN server_members sm ON s.id = sm.server_id AND sm.user_id = ?
      WHERE LOWER(c.name) LIKE LOWER(?) OR LOWER(c.topic) LIKE LOWER(?)
      ORDER BY c.position ASC LIMIT 10
    `).all(req.user.id, pattern, pattern);

    // 3. Search Servers
    const servers = db.prepare(`
      SELECT s.id, s.name, s.description, s.icon, s.banner,
             (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
      FROM servers s
      WHERE (LOWER(s.name) LIKE LOWER(?) OR LOWER(s.description) LIKE LOWER(?)) AND s.is_public = 1
      LIMIT 8
    `).all(pattern, pattern);

    // 4. Search Users
    const users = db.prepare(`
      SELECT id, username, avatar, bio, custom_status, status, badge, role
      FROM users
      WHERE (LOWER(username) LIKE LOWER(?) OR LOWER(custom_status) LIKE LOWER(?)) AND is_banned = 0
      LIMIT 10
    `).all(pattern, pattern);

    res.json({
      query: cleanQuery,
      messages,
      channels,
      servers,
      users
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search execution failed.' });
  }
});

export default router;
