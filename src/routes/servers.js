import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// List user's joined servers
router.get('/', authenticateToken, (req, res) => {
  try {
    const servers = db.prepare(`
      SELECT s.id, s.name, s.description, s.icon, s.banner, s.owner_id, s.is_public, sm.role as member_role,
             (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
      FROM servers s
      JOIN server_members sm ON s.id = sm.server_id AND sm.user_id = ?
      ORDER BY s.created_at ASC
    `).all(req.user.id);

    res.json({ servers });
  } catch (error) {
    console.error('Fetch servers error:', error);
    res.status(500).json({ error: 'Failed to fetch servers.' });
  }
});

// Explore public gaming servers
router.get('/explore', authenticateToken, (req, res) => {
  try {
    const { q } = req.query;
    let query = `
      SELECT s.id, s.name, s.description, s.icon, s.banner, s.owner_id, s.created_at,
             (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count,
             EXISTS(SELECT 1 FROM server_members WHERE server_id = s.id AND user_id = ?) as is_joined
      FROM servers s
      WHERE s.is_public = 1
    `;
    const params = [req.user.id];

    if (q) {
      query += ` AND (LOWER(s.name) LIKE LOWER(?) OR LOWER(s.description) LIKE LOWER(?))`;
      params.push(`%${q}%`, `%${q}%`);
    }

    query += ` ORDER BY member_count DESC, s.created_at DESC LIMIT 30`;

    const servers = db.prepare(query).all(...params);
    res.json({ servers });
  } catch (error) {
    console.error('Explore servers error:', error);
    res.status(500).json({ error: 'Failed to explore servers.' });
  }
});

// Create new server
router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, description = '', icon, is_public = 1 } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Server name is required.' });
    }

    const trimmedName = name.trim().substring(0, 50);
    const serverId = 'srv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const defaultIcon = icon || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(trimmedName)}&backgroundColor=09090b,18181b`;

    db.prepare(`
      INSERT INTO servers (id, name, description, icon, owner_id, is_public)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(serverId, trimmedName, description.trim(), defaultIcon, req.user.id, is_public ? 1 : 0);

    // Add creator as owner member
    db.prepare(`
      INSERT INTO server_members (id, server_id, user_id, role)
      VALUES (?, ?, ?, 'owner')
    `).run(`mem_${serverId}_${req.user.id}`, serverId, req.user.id);

    // Create default channels
    const defaultChannels = [
      { id: `chn_${serverId}_welcome`, name: 'welcome', type: 'text', category: 'INFORMATION', position: 0 },
      { id: `chn_${serverId}_general`, name: 'general-chat', type: 'text', category: 'COMMUNITY', position: 1 },
      { id: `chn_${serverId}_clips`, name: 'gaming-clips', type: 'text', category: 'COMMUNITY', position: 2 },
      { id: `chn_${serverId}_voice`, name: 'Lounge Voice', type: 'voice', category: 'VOICE CHANNELS', position: 3 },
    ];

    const insertChannel = db.prepare(`
      INSERT INTO channels (id, server_id, name, type, category, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const ch of defaultChannels) {
      insertChannel.run(ch.id, serverId, ch.name, ch.type, ch.category, ch.position);
    }

    // Default welcome message
    db.prepare(`
      INSERT INTO messages (id, channel_id, server_id, user_id, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `msg_${Date.now()}`,
      `chn_${serverId}_welcome`,
      serverId,
      req.user.id,
      `🎮 Welcome to the **${trimmedName}** server on VidCord! Customize channels, invite gamers, and have fun.`
    );

    // Log action
    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'SERVER_CREATED',
      `Server "${trimmedName}" (${serverId}) created by ${req.user.username}`,
      req.user.id
    );

    const createdServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(serverId);

    res.status(201).json({
      message: 'Server created successfully!',
      server: { ...createdServer, member_role: 'owner', member_count: 1 },
      channels
    });
  } catch (error) {
    console.error('Create server error:', error);
    res.status(500).json({ error: 'Failed to create server.' });
  }
});

// Get server details, channels, and members
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const serverId = req.params.id;
    const server = db.prepare(`
      SELECT s.*, 
             sm.role as member_role,
             (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
      FROM servers s
      LEFT JOIN server_members sm ON s.id = sm.server_id AND sm.user_id = ?
      WHERE s.id = ?
    `).get(req.user.id, serverId);

    if (!server) {
      return res.status(404).json({ error: 'Server not found.' });
    }

    const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(serverId);

    const members = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.bio, u.custom_status, u.status, u.role as platform_role, u.badge, sm.role as server_role, sm.nickname, sm.joined_at
      FROM server_members sm
      JOIN users u ON sm.user_id = u.id
      WHERE sm.server_id = ? AND u.is_banned = 0
      ORDER BY 
        CASE sm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 3 ELSE 4 END,
        CASE u.status WHEN 'online' THEN 1 WHEN 'idle' THEN 2 WHEN 'dnd' THEN 3 ELSE 4 END,
        u.username ASC
    `).all(serverId);

    res.json({ server, channels, members });
  } catch (error) {
    console.error('Get server details error:', error);
    res.status(500).json({ error: 'Failed to get server details.' });
  }
});

// Join server
router.post('/:id/join', authenticateToken, (req, res) => {
  try {
    const serverId = req.params.id;
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

    if (!server) {
      return res.status(404).json({ error: 'Server not found.' });
    }

    // Check if already member
    const existing = db.prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
    if (existing) {
      return res.json({ message: 'Already a member of this server.', server });
    }

    db.prepare(`
      INSERT INTO server_members (id, server_id, user_id, role)
      VALUES (?, ?, ?, 'member')
    `).run(`mem_${serverId}_${req.user.id}`, serverId, req.user.id);

    res.json({ message: `Successfully joined ${server.name}!`, server });
  } catch (error) {
    console.error('Join server error:', error);
    res.status(500).json({ error: 'Failed to join server.' });
  }
});

// Leave server
router.delete('/:id/leave', authenticateToken, (req, res) => {
  try {
    const serverId = req.params.id;
    const member = db.prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);

    if (!member) {
      return res.status(400).json({ error: 'You are not a member of this server.' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Server owners cannot leave. You can delete the server or transfer ownership.' });
    }

    db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, req.user.id);

    res.json({ message: 'Left server successfully.' });
  } catch (error) {
    console.error('Leave server error:', error);
    res.status(500).json({ error: 'Failed to leave server.' });
  }
});

// Create channel in server
router.post('/:id/channels', authenticateToken, (req, res) => {
  try {
    const serverId = req.params.id;
    const { name, type = 'text', category = 'TEXT CHANNELS', topic = '' } = req.body;

    // Check permissions (owner, server admin/moderator or global admin)
    const member = db.prepare('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
    const hasPermission = req.user.role === 'admin' || (member && ['owner', 'admin', 'moderator'].includes(member.role));

    if (!hasPermission) {
      return res.status(403).json({ error: 'You do not have permission to manage channels in this server.' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Channel name is required.' });
    }

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    const channelId = `chn_${serverId}_${Date.now()}`;

    db.prepare(`
      INSERT INTO channels (id, server_id, name, type, category, topic)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(channelId, serverId, cleanName, type, category, topic);

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);

    res.status(201).json({ message: 'Channel created!', channel });
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel.' });
  }
});

// Delete channel
router.delete('/:id/channels/:channelId', authenticateToken, (req, res) => {
  try {
    const { id: serverId, channelId } = req.params;

    const member = db.prepare('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
    const hasPermission = req.user.role === 'admin' || (member && ['owner', 'admin'].includes(member.role));

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    db.prepare('DELETE FROM channels WHERE id = ? AND server_id = ?').run(channelId, serverId);

    res.json({ message: 'Channel deleted.' });
  } catch (error) {
    console.error('Delete channel error:', error);
    res.status(500).json({ error: 'Failed to delete channel.' });
  }
});

export default router;
