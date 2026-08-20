import express from 'express';
import db from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Apply auth + requireAdmin to all admin endpoints
router.use(authenticateToken);
router.use(requireAdmin);

// 1. Platform Metrics & Stats
router.get('/stats', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const onlineUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE status IN ('online', 'idle', 'dnd') AND is_banned = 0").get().c;
    const bannedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c;
    const totalServers = db.prepare('SELECT COUNT(*) as c FROM servers').get().c;
    const totalMessages = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
    const totalDMs = db.prepare('SELECT COUNT(*) as c FROM direct_messages').get().c;
    const recentLogs = db.prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 15').all();

    res.json({
      metrics: {
        totalUsers,
        onlineUsers,
        bannedUsers,
        totalServers,
        totalMessages: totalMessages + totalDMs,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      recentLogs
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// 2. All Users List
router.get('/users', (req, res) => {
  try {
    const { q, role, banned } = req.query;
    let query = `
      SELECT id, username, email, avatar, bio, custom_status, status, role, badge, is_banned, created_at,
             (SELECT COUNT(*) FROM messages WHERE user_id = users.id) as message_count,
             (SELECT COUNT(*) FROM server_members WHERE user_id = users.id) as server_count
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      query += ` AND (LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?))`;
      params.push(`%${q}%`, `%${q}%`);
    }

    if (role && role !== 'all') {
      query += ` AND role = ?`;
      params.push(role);
    }

    if (banned === '1') {
      query += ` AND is_banned = 1`;
    } else if (banned === '0') {
      query += ` AND is_banned = 0`;
    }

    query += ` ORDER BY created_at DESC`;
    const users = db.prepare(query).all(...params);

    res.json({ users });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch user directory.' });
  }
});

// 3. Update User Role (Admin / Moderator / User)
router.patch('/users/:id/role', (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { role, badge } = req.body;

    if (!['admin', 'moderator', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified.' });
    }

    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const newBadge = badge || (role === 'admin' ? 'admin' : (role === 'moderator' ? 'pro_gamer' : 'member'));

    db.prepare('UPDATE users SET role = ?, badge = ? WHERE id = ?').run(role, newBadge, targetUserId);

    // Audit log
    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'USER_ROLE_UPDATED',
      `Admin ${req.user.username} changed role of ${target.username} to ${role} (badge: ${newBadge}).`,
      req.user.id
    );

    res.json({ message: `Role updated to ${role}.`, role, badge: newBadge });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({ error: 'Failed to change role.' });
  }
});

// 4. Ban / Unban User
router.post('/users/:id/ban', (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { reason = 'Violation of platform security rules' } = req.body;

    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'You cannot ban yourself.' });
    }

    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Cannot ban another administrator.' });
    }

    db.prepare("UPDATE users SET is_banned = 1, status = 'offline' WHERE id = ?").run(targetUserId);

    const banId = 'ban_' + Date.now();
    db.prepare('INSERT INTO bans (id, server_id, user_id, banned_by, reason) VALUES (?, NULL, ?, ?, ?)').run(
      banId, targetUserId, req.user.id, reason
    );

    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'USER_BANNED',
      `Admin ${req.user.username} permanently banned user ${target.username}. Reason: ${reason}`,
      req.user.id
    );

    res.json({ message: `User ${target.username} has been banned.` });
  } catch (error) {
    console.error('Ban error:', error);
    res.status(500).json({ error: 'Failed to ban user.' });
  }
});

router.post('/users/:id/unban', (req, res) => {
  try {
    const targetUserId = req.params.id;
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId);

    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(targetUserId);
    db.prepare('DELETE FROM bans WHERE user_id = ? AND server_id IS NULL').run(targetUserId);

    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'USER_UNBANNED',
      `Admin ${req.user.username} unbanned user ${target.username}.`,
      req.user.id
    );

    res.json({ message: `User ${target.username} unbanned successfully.` });
  } catch (error) {
    console.error('Unban error:', error);
    res.status(500).json({ error: 'Failed to unban user.' });
  }
});

// 5. System Announcement Broadcast
router.post('/announcement', (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message content are required.' });
    }

    const formattedContent = `📢 **[OFFICIAL SYSTEM ANNOUNCEMENT: ${title.toUpperCase()}]**\n\n${message}\n\n*— Sent by Platform Administration (@${req.user.username})*`;

    // Find general or first channel in all servers
    const servers = db.prepare('SELECT id, name FROM servers').all();
    let sentCount = 0;

    const insertMsg = db.prepare(`
      INSERT INTO messages (id, channel_id, server_id, user_id, content, is_pinned)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const s of servers) {
      const channel = db.prepare("SELECT id FROM channels WHERE server_id = ? ORDER BY CASE WHEN name LIKE '%general%' THEN 0 ELSE 1 END, position ASC LIMIT 1").get(s.id);
      if (channel) {
        insertMsg.run(`sys_ann_${Date.now()}_${s.id}`, channel.id, s.id, req.user.id, formattedContent);
        sentCount++;
      }
    }

    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'SYSTEM_ANNOUNCEMENT_BROADCAST',
      `Admin ${req.user.username} broadcasted announcement: "${title}" across ${sentCount} servers.`,
      req.user.id
    );

    res.json({ message: `Announcement broadcasted to ${sentCount} gaming communities!`, sentCount });
  } catch (error) {
    console.error('Announcement error:', error);
    res.status(500).json({ error: 'Broadcast failed.' });
  }
});

// 6. List Servers for Admin Management
router.get('/servers', (req, res) => {
  try {
    const servers = db.prepare(`
      SELECT s.*, u.username as owner_username,
             (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count,
             (SELECT COUNT(*) FROM channels WHERE server_id = s.id) as channel_count,
             (SELECT COUNT(*) FROM messages WHERE server_id = s.id) as message_count
      FROM servers s
      JOIN users u ON s.owner_id = u.id
      ORDER BY member_count DESC
    `).all();

    res.json({ servers });
  } catch (error) {
    console.error('Admin servers error:', error);
    res.status(500).json({ error: 'Failed to fetch servers.' });
  }
});

// 7. Delete Server (Admin action)
router.delete('/servers/:id', (req, res) => {
  try {
    const serverId = req.params.id;
    const server = db.prepare('SELECT name FROM servers WHERE id = ?').get(serverId);

    if (!server) {
      return res.status(404).json({ error: 'Server not found.' });
    }

    db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);

    db.prepare('INSERT INTO system_logs (id, action, details, user_id) VALUES (?, ?, ?, ?)').run(
      'log_' + Date.now(),
      'SERVER_DELETED_BY_ADMIN',
      `Admin ${req.user.username} removed server "${server.name}" (${serverId}).`,
      req.user.id
    );

    res.json({ message: `Server "${server.name}" has been deleted.` });
  } catch (error) {
    console.error('Admin delete server error:', error);
    res.status(500).json({ error: 'Failed to delete server.' });
  }
});

export default router;
