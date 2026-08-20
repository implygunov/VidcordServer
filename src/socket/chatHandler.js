import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';
import db from '../db.js';

// Track online sockets: Map<userId, Set<socketId>>
const onlineSockets = new Map();
// Track voice/video room participants: Map<channelId, Map<userId, { id, username, avatar, isMuted, isDeaf, isCameraOn, isScreenSharing, isSpeaking }>>
const voiceRooms = new Map();

export function getVoiceParticipantsForChannel(channelId) {
  if (voiceRooms.has(channelId)) {
    return Array.from(voiceRooms.get(channelId).values());
  }
  return [];
}

export function getAllVoiceStates() {
  const result = {};
  for (const [channelId, room] of voiceRooms.entries()) {
    result[channelId] = Array.from(room.values());
  }
  return result;
}

export function setupSocketIO(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, username, avatar, status, role, badge, is_nitro, is_banned FROM users WHERE id = ?').get(decoded.id);
      if (!user || user.is_banned) {
        return next(new Error('Unauthorized or banned user'));
      }
      socket.user = user;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    const userId = user.id;

    if (!onlineSockets.has(userId)) {
      onlineSockets.set(userId, new Set());
      db.prepare("UPDATE users SET status = CASE WHEN status = 'offline' THEN 'online' ELSE status END WHERE id = ?").run(userId);
      io.emit('user_presence_update', {
        userId,
        status: user.status === 'offline' ? 'online' : user.status,
        username: user.username
      });
    }
    onlineSockets.get(userId).add(socket.id);

    // Join personal user room for direct pings, calls & DMs
    socket.join(`user_${userId}`);

    // Send initial voice states to newly connected client
    socket.emit('initial_voice_states', { voiceStates: getAllVoiceStates() });

    // Channel Rooms
    socket.on('join_channel', ({ channelId }) => {
      socket.join(`channel_${channelId}`);
    });

    socket.on('leave_channel', ({ channelId }) => {
      socket.leave(`channel_${channelId}`);
    });

    // Request voice states refresh
    socket.on('get_voice_states', () => {
      socket.emit('initial_voice_states', { voiceStates: getAllVoiceStates() });
    });

    // Real-time Channel Messaging
    socket.on('send_channel_message', ({ channelId, content, replyToId, attachments }) => {
      try {
        if (!content && (!attachments || attachments.length === 0)) return;

        const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
        if (!channel) return;

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const trimmedContent = (content || '').trim();

        db.prepare(`
          INSERT INTO messages (id, channel_id, server_id, user_id, content, reply_to_id, attachments)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(messageId, channelId, channel.server_id, userId, trimmedContent, replyToId || null, JSON.stringify(attachments || []));

        let replyInfo = null;
        if (replyToId) {
          replyInfo = db.prepare(`
            SELECT m.content as reply_content, u.username as reply_username
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.id = ?
          `).get(replyToId);
        }

        const message = {
          id: messageId,
          channel_id: channelId,
          server_id: channel.server_id,
          user_id: userId,
          content: trimmedContent,
          reply_to_id: replyToId || null,
          attachments: attachments || [],
          is_pinned: 0,
          is_edited: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          username: user.username,
          avatar: user.avatar,
          user_platform_role: user.role,
          user_badge: user.badge,
          is_nitro: user.is_nitro || 0,
          custom_status: user.custom_status,
          reply_content: replyInfo ? replyInfo.reply_content : null,
          reply_username: replyInfo ? replyInfo.reply_username : null,
          reactions: []
        };

        io.to(`channel_${channelId}`).emit('new_channel_message', { message });
      } catch (err) {
        console.error('Socket send_channel_message error:', err);
      }
    });

    // Real-time Direct Messaging
    socket.on('send_dm', ({ targetUserId, content, attachments }) => {
      try {
        if (!content && (!attachments || attachments.length === 0)) return;

        const [u1, u2] = [userId, targetUserId].sort();
        let convo = db.prepare('SELECT id FROM direct_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);
        if (!convo) {
          const convoId = `dm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          db.prepare('INSERT INTO direct_conversations (id, user1_id, user2_id) VALUES (?, ?, ?)').run(convoId, u1, u2);
          convo = { id: convoId };
        }

        const msgId = `dm_msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const trimmed = (content || '').trim();

        db.prepare(`
          INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, content, attachments)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(msgId, convo.id, userId, targetUserId, trimmed, JSON.stringify(attachments || []));

        db.prepare('UPDATE direct_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convo.id);

        const message = {
          id: msgId,
          conversation_id: convo.id,
          sender_id: userId,
          receiver_id: targetUserId,
          content: trimmed,
          attachments: attachments || [],
          is_edited: 0,
          created_at: new Date().toISOString(),
          sender_username: user.username,
          sender_avatar: user.avatar
        };

        io.to(`user_${userId}`).emit('new_direct_message', { message, partnerId: targetUserId });
        io.to(`user_${targetUserId}`).emit('new_direct_message', { message, partnerId: userId });
      } catch (err) {
        console.error('Socket send_dm error:', err);
      }
    });

    // Typing Indicators
    socket.on('typing_start', ({ channelId }) => {
      socket.to(`channel_${channelId}`).emit('user_typing', { channelId, userId, username: user.username });
    });

    socket.on('typing_stop', ({ channelId }) => {
      socket.to(`channel_${channelId}`).emit('user_stop_typing', { channelId, userId });
    });

    // Status Update
    socket.on('update_status', ({ status, custom_status }) => {
      try {
        db.prepare('UPDATE users SET status = ?, custom_status = COALESCE(?, custom_status) WHERE id = ?').run(status, custom_status, userId);
        io.emit('user_presence_update', { userId, status, custom_status, username: user.username });
      } catch (e) {
        console.error('Status update socket error:', e);
      }
    });

    // ==========================================
    // 📞 WEBRTC DIRECT CALL & SCREEN SHARE EVENTS
    // ==========================================
    socket.on('initiate_call', ({ targetUserId, callType }) => {
      io.to(`user_${targetUserId}`).emit('incoming_call_request', {
        caller: {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          badge: user.badge
        },
        callType: callType || 'video'
      });
    });

    socket.on('accept_call', ({ callerId }) => {
      io.to(`user_${callerId}`).emit('call_accepted_by_user', {
        acceptor: {
          id: user.id,
          username: user.username,
          avatar: user.avatar
        }
      });
    });

    socket.on('decline_call', ({ callerId }) => {
      io.to(`user_${callerId}`).emit('call_declined_by_user', {
        declinerId: user.id
      });
    });

    socket.on('end_call', ({ targetUserId }) => {
      io.to(`user_${targetUserId}`).emit('call_ended_by_user', {
        endedById: user.id
      });
    });

    socket.on('webrtc_signal', ({ targetUserId, signal }) => {
      io.to(`user_${targetUserId}`).emit('webrtc_signal_received', {
        senderId: user.id,
        signal
      });
    });

    // ==========================================
    // 🎙️ SERVER VOICE & VIDEO CHANNELS
    // ==========================================
    socket.on('join_voice', ({ channelId }) => {
      if (!voiceRooms.has(channelId)) {
        voiceRooms.set(channelId, new Map());
      }
      voiceRooms.get(channelId).set(userId, {
        id: userId,
        username: user.username,
        avatar: user.avatar,
        isMuted: false,
        isDeaf: false,
        isCameraOn: false,
        isScreenSharing: false,
        isSpeaking: false
      });

      const participants = Array.from(voiceRooms.get(channelId).values());
      // Broadcast to ALL sockets on server so sidebar shows live participants immediately
      io.emit('voice_state_update', { channelId, participants });
    });

    socket.on('leave_voice', ({ channelId }) => {
      if (voiceRooms.has(channelId)) {
        voiceRooms.get(channelId).delete(userId);
        const participants = Array.from(voiceRooms.get(channelId).values());
        io.emit('voice_state_update', { channelId, participants });
      }
    });

    socket.on('voice_toggle_state', ({ channelId, isMuted, isDeaf, isCameraOn, isScreenSharing }) => {
      if (voiceRooms.has(channelId) && voiceRooms.get(channelId).has(userId)) {
        const p = voiceRooms.get(channelId).get(userId);
        if (isMuted !== undefined) p.isMuted = isMuted;
        if (isDeaf !== undefined) p.isDeaf = isDeaf;
        if (isCameraOn !== undefined) p.isCameraOn = isCameraOn;
        if (isScreenSharing !== undefined) p.isScreenSharing = isScreenSharing;
        const participants = Array.from(voiceRooms.get(channelId).values());
        io.emit('voice_state_update', { channelId, participants });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      const userSockets = onlineSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineSockets.delete(userId);
          setTimeout(() => {
            if (!onlineSockets.has(userId)) {
              db.prepare("UPDATE users SET status = 'offline' WHERE id = ?").run(userId);
              io.emit('user_presence_update', {
                userId,
                status: 'offline',
                username: user.username
              });
            }
          }, 3000);
        }
      }

      for (const [channelId, room] of voiceRooms.entries()) {
        if (room.has(userId)) {
          room.delete(userId);
          const participants = Array.from(room.values());
          io.emit('voice_state_update', { channelId, participants });
        }
      }
    });
  });
}
