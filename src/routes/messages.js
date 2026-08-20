import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get channel message history
router.get('/channel/:channelId', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const { limit = 60, before } = req.query;

    let query = `
      SELECT m.id, m.channel_id, m.server_id, m.user_id, m.content, m.reply_to_id, 
             m.attachments, m.is_pinned, m.is_edited, m.created_at, m.updated_at,
             u.username, u.avatar, u.role as user_platform_role, u.badge as user_badge, u.custom_status,
             r.content as reply_content, ru.username as reply_username
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN messages r ON m.reply_to_id = r.id
      LEFT JOIN users ru ON r.user_id = ru.id
      WHERE m.channel_id = ?
    `;
    const params = [channelId];

    if (before) {
      query += ` AND m.created_at < ?`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const rawMessages = db.prepare(query).all(...params);

    // Fetch reactions for these messages
    const messageIds = rawMessages.map(m => m.id);
    let reactionsByMessage = {};

    if (messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',');
      const reactions = db.prepare(`
        SELECT mr.message_id, mr.emoji, mr.user_id, u.username
        FROM message_reactions mr
        JOIN users u ON mr.user_id = u.id
        WHERE mr.message_id IN (${placeholders})
      `).all(...messageIds);

      for (const rx of reactions) {
        if (!reactionsByMessage[rx.message_id]) {
          reactionsByMessage[rx.message_id] = {};
        }
        if (!reactionsByMessage[rx.message_id][rx.emoji]) {
          reactionsByMessage[rx.message_id][rx.emoji] = {
            emoji: rx.emoji,
            count: 0,
            users: [],
            hasReacted: false
          };
        }
        reactionsByMessage[rx.message_id][rx.emoji].count += 1;
        reactionsByMessage[rx.message_id][rx.emoji].users.push(rx.username);
        if (rx.user_id === req.user.id) {
          reactionsByMessage[rx.message_id][rx.emoji].hasReacted = true;
        }
      }
    }

    const messages = rawMessages.reverse().map(m => {
      let attachments = [];
      try {
        attachments = JSON.parse(m.attachments || '[]');
      } catch (e) {
        attachments = [];
      }

      return {
        ...m,
        attachments,
        reactions: Object.values(reactionsByMessage[m.id] || {})
      };
    });

    res.json({ messages });
  } catch (error) {
    console.error('Fetch messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// Send message to channel
router.post('/channel/:channelId', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const { content, reply_to_id = null, attachments = [] } = req.body;

    if ((!content || content.trim().length === 0) && attachments.length === 0) {
      return res.status(400).json({ error: 'Message content or attachment is required.' });
    }

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found.' });
    }

    // Check membership
    const member = db.prepare('SELECT id FROM server_members WHERE server_id = ? AND user_id = ?').get(channel.server_id, req.user.id);
    if (!member && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You must be a member of this server to post messages.' });
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const trimmedContent = (content || '').trim();

    db.prepare(`
      INSERT INTO messages (id, channel_id, server_id, user_id, content, reply_to_id, attachments)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      channelId,
      channel.server_id,
      req.user.id,
      trimmedContent,
      reply_to_id,
      JSON.stringify(attachments)
    );

    // Get reply details if any
    let replyInfo = null;
    if (reply_to_id) {
      replyInfo = db.prepare(`
        SELECT m.content as reply_content, u.username as reply_username
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
      `).get(reply_to_id);
    }

    const message = {
      id: messageId,
      channel_id: channelId,
      server_id: channel.server_id,
      user_id: req.user.id,
      content: trimmedContent,
      reply_to_id,
      attachments,
      is_pinned: 0,
      is_edited: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      username: req.user.username,
      avatar: req.user.avatar,
      user_platform_role: req.user.role,
      user_badge: req.user.badge,
      custom_status: req.user.custom_status,
      reply_content: replyInfo ? replyInfo.reply_content : null,
      reply_username: replyInfo ? replyInfo.reply_username : null,
      reactions: []
    };

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// Edit message
router.patch('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content cannot be empty.' });
    }

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (msg.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own messages.' });
    }

    const trimmed = content.trim();
    db.prepare(`
      UPDATE messages 
      SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(trimmed, id);

    res.json({ message: 'Message updated', content: trimmed });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message.' });
  }
});

// Delete message
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

    if (!msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    // Check if author, server moderator/owner, or platform admin
    const member = db.prepare('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?').get(msg.server_id, req.user.id);
    const canDelete = msg.user_id === req.user.id || req.user.role === 'admin' || (member && ['owner', 'admin', 'moderator'].includes(member.role));

    if (!canDelete) {
      return res.status(403).json({ error: 'Permission denied to delete this message.' });
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(id);

    res.json({ message: 'Message deleted successfully', messageId: id, channelId: msg.channel_id });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message.' });
  }
});

// Toggle reaction
router.post('/:id/reactions', authenticateToken, (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required.' });
    }

    const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, req.user.id, emoji);

    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
      res.json({ action: 'removed', emoji, messageId });
    } else {
      const rxId = `rx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      db.prepare('INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(rxId, messageId, req.user.id, emoji);
      res.json({ action: 'added', emoji, messageId });
    }
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to update reaction.' });
  }
});

// Toggle pin message
router.post('/:id/pin', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

    if (!msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const newPinned = msg.is_pinned ? 0 : 1;
    db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(newPinned, id);

    res.json({ message: newPinned ? 'Message pinned' : 'Message unpinned', is_pinned: newPinned });
  } catch (error) {
    console.error('Pin error:', error);
    res.status(500).json({ error: 'Failed to toggle pin.' });
  }
});

export default router;
