import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Helper to get or create conversation
function getOrCreateConversation(user1, user2) {
  const [u1, u2] = [user1, user2].sort();
  let convo = db.prepare('SELECT * FROM direct_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);

  if (!convo) {
    const convoId = `dm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare('INSERT INTO direct_conversations (id, user1_id, user2_id) VALUES (?, ?, ?)').run(convoId, u1, u2);
    convo = { id: convoId, user1_id: u1, user2_id: u2 };
  }
  return convo;
}

// Get all active DM conversations for current user
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const convos = db.prepare(`
      SELECT dc.id, dc.user1_id, dc.user2_id, dc.updated_at,
             CASE WHEN dc.user1_id = ? THEN dc.user2_id ELSE dc.user1_id END as partner_id,
             u.username as partner_username, u.avatar as partner_avatar, u.status as partner_status,
             u.custom_status as partner_custom_status, u.badge as partner_badge,
             (SELECT content FROM direct_messages WHERE conversation_id = dc.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM direct_messages WHERE conversation_id = dc.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
             (SELECT sender_id FROM direct_messages WHERE conversation_id = dc.id ORDER BY created_at DESC LIMIT 1) as last_message_sender_id
      FROM direct_conversations dc
      JOIN users u ON u.id = (CASE WHEN dc.user1_id = ? THEN dc.user2_id ELSE dc.user1_id END)
      WHERE (dc.user1_id = ? OR dc.user2_id = ?) AND u.is_banned = 0
      ORDER BY dc.updated_at DESC
    `).all(userId, userId, userId, userId);

    res.json({ conversations: convos });
  } catch (error) {
    console.error('Fetch DMs error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

// Get messages with a specific user
router.get('/user/:targetUserId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const targetUserId = req.params.targetUserId;

    const targetUser = db.prepare('SELECT id, username, avatar, banner, bio, custom_status, status, badge, role FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const convo = getOrCreateConversation(userId, targetUserId);

    const messages = db.prepare(`
      SELECT dm.id, dm.conversation_id, dm.sender_id, dm.receiver_id, dm.content, 
             dm.reply_to_id, dm.attachments, dm.is_edited, dm.created_at,
             u.username as sender_username, u.avatar as sender_avatar
      FROM direct_messages dm
      JOIN users u ON dm.sender_id = u.id
      WHERE dm.conversation_id = ?
      ORDER BY dm.created_at ASC
    `).all(convo.id);

    const parsedMessages = messages.map(m => {
      let attachments = [];
      try {
        attachments = JSON.parse(m.attachments || '[]');
      } catch (e) {
        attachments = [];
      }
      return { ...m, attachments };
    });

    res.json({
      conversation: convo,
      targetUser,
      messages: parsedMessages
    });
  } catch (error) {
    console.error('Fetch DM messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// Send a direct message
router.post('/user/:targetUserId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const targetUserId = req.params.targetUserId;
    const { content, attachments = [] } = req.body;

    if ((!content || content.trim().length === 0) && attachments.length === 0) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const targetUser = db.prepare('SELECT id, is_banned FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser || targetUser.is_banned) {
      return res.status(404).json({ error: 'User unavailable or banned.' });
    }

    const convo = getOrCreateConversation(userId, targetUserId);
    const msgId = `dm_msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const trimmed = (content || '').trim();

    db.prepare(`
      INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, content, attachments)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msgId, convo.id, userId, targetUserId, trimmed, JSON.stringify(attachments));

    db.prepare('UPDATE direct_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convo.id);

    const message = {
      id: msgId,
      conversation_id: convo.id,
      sender_id: userId,
      receiver_id: targetUserId,
      content: trimmed,
      attachments,
      is_edited: 0,
      created_at: new Date().toISOString(),
      sender_username: req.user.username,
      sender_avatar: req.user.avatar
    };

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send DM error:', error);
    res.status(500).json({ error: 'Failed to send direct message.' });
  }
});

export default router;
