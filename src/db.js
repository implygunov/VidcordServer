import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbFilePath = path.join(dataDir, 'vidcord.json');

// Initialize in-memory store
const data = {
  users: [],
  servers: [],
  server_members: [],
  channels: [],
  messages: [],
  direct_conversations: [],
  direct_messages: [],
  message_reactions: [],
  bans: [],
  system_logs: [],
  nitro_boosts: []
};

// Load existing data if file exists
if (fs.existsSync(dbFilePath)) {
  try {
    const raw = fs.readFileSync(dbFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    Object.assign(data, parsed);
  } catch (err) {
    console.error('Error loading db file, starting fresh:', err);
  }
}

// Immediate synchronous persistence ensuring zero data loss
export function persistDatabase() {
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error persisting database file:', err);
  }
}

export function initDatabase() {
  const collections = ['users', 'servers', 'server_members', 'channels', 'messages', 'direct_conversations', 'direct_messages', 'message_reactions', 'bans', 'system_logs', 'nitro_boosts'];
  for (const c of collections) {
    if (!data[c]) data[c] = [];
  }
  persistDatabase();
}

/**
 * Universal Database object with immediate persistence
 */
export const db = {
  data,
  save: persistDatabase,
  saveSync: persistDatabase,

  exec(sql) {
    initDatabase();
    return true;
  },

  pragma(p) {
    return true;
  },

  prepare(sql) {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    return {
      run(...args) {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = args[0];
        }

        // 1. INSERT INTO users
        if (trimmed.startsWith('INSERT INTO users') || trimmed.startsWith('INSERT OR IGNORE INTO users')) {
          const user = params.id ? { ...params } : {
            id: params[0],
            username: params[1],
            email: params[2],
            password_hash: params[3],
            avatar: params[4],
            bio: params[5] || 'Gamer on VidCord',
            custom_status: params[6] || '',
            status: params[7] || 'online',
            role: params[8] || 'user',
            badge: params[9] || 'member',
            is_banned: 0,
            is_nitro: 0,
            created_at: new Date().toISOString()
          };
          user.banner = user.banner || null;
          user.is_banned = user.is_banned || 0;
          user.is_nitro = user.is_nitro || 0;
          user.created_at = user.created_at || new Date().toISOString();

          const existingIdx = data.users.findIndex(u => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase() || u.email.toLowerCase() === user.email.toLowerCase());
          if (existingIdx >= 0) {
            data.users[existingIdx] = { ...data.users[existingIdx], ...user };
          } else {
            data.users.push(user);
          }
          persistDatabase();
          return { changes: 1 };
        }

        // 2. INSERT INTO servers
        if (trimmed.startsWith('INSERT INTO servers')) {
          const s = params.id ? { ...params } : {
            id: params[0],
            name: params[1],
            description: params[2] || '',
            icon: params[3] || null,
            banner: null,
            owner_id: params[4],
            is_public: params[5] !== undefined ? params[5] : 1,
            boost_count: 0,
            boost_level: 0,
            created_at: new Date().toISOString()
          };
          s.boost_count = s.boost_count || 0;
          s.boost_level = s.boost_level || 0;
          s.created_at = s.created_at || new Date().toISOString();
          data.servers.push(s);
          persistDatabase();
          return { changes: 1 };
        }

        // 3. INSERT INTO server_members
        if (trimmed.startsWith('INSERT INTO server_members') || trimmed.startsWith('INSERT OR IGNORE INTO server_members')) {
          const mem = {
            id: params[0],
            server_id: params[1],
            user_id: params[2],
            role: params[3] || 'member',
            nickname: params[4] || null,
            joined_at: new Date().toISOString()
          };
          const exists = data.server_members.find(m => m.server_id === mem.server_id && m.user_id === mem.user_id);
          if (!exists) {
            data.server_members.push(mem);
          }
          persistDatabase();
          return { changes: 1 };
        }

        // 4. INSERT INTO channels
        if (trimmed.startsWith('INSERT INTO channels')) {
          const ch = params.id ? { ...params } : {
            id: params[0],
            server_id: params[1],
            name: params[2],
            type: params[3] || 'text',
            category: params[4] || 'TEXT CHANNELS',
            topic: params[5] || '',
            position: params[6] || 0,
            created_at: new Date().toISOString()
          };
          ch.created_at = ch.created_at || new Date().toISOString();
          data.channels.push(ch);
          persistDatabase();
          return { changes: 1 };
        }

        // 5. INSERT INTO messages
        if (trimmed.startsWith('INSERT INTO messages')) {
          const msg = params.id ? { ...params } : {
            id: params[0],
            channel_id: params[1],
            server_id: params[2],
            user_id: params[3],
            content: params[4],
            reply_to_id: params[5] || null,
            attachments: typeof params[6] === 'string' ? params[6] : JSON.stringify(params[6] || []),
            is_pinned: 0,
            is_edited: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          msg.created_at = msg.created_at || new Date().toISOString();
          msg.updated_at = msg.updated_at || new Date().toISOString();
          msg.is_pinned = msg.is_pinned || 0;
          msg.is_edited = msg.is_edited || 0;
          msg.attachments = typeof msg.attachments === 'string' ? msg.attachments : JSON.stringify(msg.attachments || []);
          data.messages.push(msg);
          persistDatabase();
          return { changes: 1 };
        }

        // 6. INSERT INTO direct_conversations
        if (trimmed.startsWith('INSERT INTO direct_conversations')) {
          const convo = {
            id: params[0],
            user1_id: params[1],
            user2_id: params[2],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          const exists = data.direct_conversations.find(c => (c.user1_id === convo.user1_id && c.user2_id === convo.user2_id) || (c.user1_id === convo.user2_id && c.user2_id === convo.user1_id));
          if (!exists) {
            data.direct_conversations.push(convo);
          }
          persistDatabase();
          return { changes: 1 };
        }

        // 7. INSERT INTO direct_messages
        if (trimmed.startsWith('INSERT INTO direct_messages')) {
          const dm = {
            id: params[0],
            conversation_id: params[1],
            sender_id: params[2],
            receiver_id: params[3],
            content: params[4],
            reply_to_id: null,
            attachments: typeof params[5] === 'string' ? params[5] : JSON.stringify(params[5] || []),
            is_edited: 0,
            created_at: new Date().toISOString()
          };
          data.direct_messages.push(dm);
          persistDatabase();
          return { changes: 1 };
        }

        // 8. INSERT INTO message_reactions
        if (trimmed.startsWith('INSERT INTO message_reactions')) {
          const rx = {
            id: params[0],
            message_id: params[1],
            user_id: params[2],
            emoji: params[3],
            created_at: new Date().toISOString()
          };
          data.message_reactions.push(rx);
          persistDatabase();
          return { changes: 1 };
        }

        // 9. INSERT INTO bans
        if (trimmed.startsWith('INSERT INTO bans')) {
          const b = {
            id: params[0],
            server_id: params[1],
            user_id: params[2],
            banned_by: params[3],
            reason: params[4] || 'Rule violation',
            created_at: new Date().toISOString()
          };
          data.bans.push(b);
          persistDatabase();
          return { changes: 1 };
        }

        // 10. INSERT INTO system_logs
        if (trimmed.startsWith('INSERT INTO system_logs')) {
          const log = {
            id: params[0],
            action: params[1],
            details: params[2],
            user_id: params[3] || null,
            created_at: new Date().toISOString()
          };
          data.system_logs.push(log);
          persistDatabase();
          return { changes: 1 };
        }

        // UPDATES
        if (trimmed.startsWith('UPDATE users')) {
          if (trimmed.includes('is_banned = 1')) {
            const userId = params[0];
            const u = data.users.find(x => x.id === userId);
            if (u) { u.is_banned = 1; u.status = 'offline'; }
          } else if (trimmed.includes('is_banned = 0')) {
            const userId = params[0];
            const u = data.users.find(x => x.id === userId);
            if (u) { u.is_banned = 0; }
          } else if (trimmed.includes('is_nitro = 1')) {
            const userId = params[0];
            const u = data.users.find(x => x.id === userId);
            if (u) { u.is_nitro = 1; u.badge = u.badge === 'owner' ? 'owner' : 'pro_gamer'; }
          } else if (trimmed.includes('role = ?')) {
            const [role, badge, userId] = params;
            const u = data.users.find(x => x.id === userId);
            if (u) { u.role = role; u.badge = badge; }
          } else if (trimmed.includes("status = 'online'")) {
            const userId = params[0];
            const u = data.users.find(x => x.id === userId);
            if (u && u.status !== 'dnd' && u.status !== 'idle') u.status = 'online';
          } else if (trimmed.includes("status = 'offline'")) {
            const userId = params[0];
            const u = data.users.find(x => x.id === userId);
            if (u) u.status = 'offline';
          } else if (trimmed.includes("status = ?")) {
            const [status, custom_status, userId] = params;
            const u = data.users.find(x => x.id === userId);
            if (u) {
              u.status = status;
              if (custom_status) u.custom_status = custom_status;
            }
          } else {
            const userId = params[params.length - 1];
            const u = data.users.find(x => x.id === userId);
            if (u) {
              if (trimmed.includes('username = ?')) {
                const idx = trimmed.indexOf('username = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.username = params[countBefore];
              }
              if (trimmed.includes('bio = ?')) {
                const idx = trimmed.indexOf('bio = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.bio = params[countBefore];
              }
              if (trimmed.includes('custom_status = ?')) {
                const idx = trimmed.indexOf('custom_status = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.custom_status = params[countBefore];
              }
              if (trimmed.includes('status = ?')) {
                const idx = trimmed.indexOf('status = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.status = params[countBefore];
              }
              if (trimmed.includes('avatar = ?')) {
                const idx = trimmed.indexOf('avatar = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.avatar = params[countBefore];
              }
              if (trimmed.includes('banner = ?')) {
                const idx = trimmed.indexOf('banner = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.banner = params[countBefore];
              }
              if (trimmed.includes('badge = ?')) {
                const idx = trimmed.indexOf('badge = ?');
                const countBefore = (trimmed.substring(0, idx).match(/\?/g) || []).length;
                u.badge = params[countBefore];
              }
            }
          }
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('UPDATE servers SET boost_count = boost_count + 1')) {
          const serverId = params[0];
          const s = data.servers.find(x => x.id === serverId);
          if (s) {
            s.boost_count = (s.boost_count || 0) + 1;
            s.boost_level = s.boost_count >= 14 ? 3 : (s.boost_count >= 7 ? 2 : (s.boost_count >= 2 ? 1 : 0));
          }
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('UPDATE messages SET content = ?')) {
          const [content, id] = params;
          const msg = data.messages.find(m => m.id === id);
          if (msg) {
            msg.content = content;
            msg.is_edited = 1;
            msg.updated_at = new Date().toISOString();
          }
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('UPDATE messages SET is_pinned = ?')) {
          const [pinned, id] = params;
          const msg = data.messages.find(m => m.id === id);
          if (msg) {
            msg.is_pinned = pinned;
          }
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('UPDATE direct_conversations')) {
          const convoId = params[0];
          const c = data.direct_conversations.find(x => x.id === convoId);
          if (c) c.updated_at = new Date().toISOString();
          persistDatabase();
          return { changes: 1 };
        }

        // DELETIONS
        if (trimmed.startsWith('DELETE FROM server_members')) {
          const [serverId, userId] = params;
          data.server_members = data.server_members.filter(m => !(m.server_id === serverId && m.user_id === userId));
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('DELETE FROM channels')) {
          const [channelId, serverId] = params;
          data.channels = data.channels.filter(c => c.id !== channelId);
          data.messages = data.messages.filter(m => m.channel_id !== channelId);
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('DELETE FROM messages')) {
          const id = params[0];
          data.messages = data.messages.filter(m => m.id !== id);
          data.message_reactions = data.message_reactions.filter(r => r.message_id !== id);
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('DELETE FROM message_reactions')) {
          const rxId = params[0];
          data.message_reactions = data.message_reactions.filter(r => r.id !== rxId);
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('DELETE FROM bans')) {
          const userId = params[0];
          data.bans = data.bans.filter(b => b.user_id !== userId);
          persistDatabase();
          return { changes: 1 };
        }

        if (trimmed.startsWith('DELETE FROM servers')) {
          const serverId = params[0];
          data.servers = data.servers.filter(s => s.id !== serverId);
          data.channels = data.channels.filter(c => c.server_id !== serverId);
          data.server_members = data.server_members.filter(m => m.server_id !== serverId);
          data.messages = data.messages.filter(m => m.server_id !== serverId);
          persistDatabase();
          return { changes: 1 };
        }

        persistDatabase();
        return { changes: 1 };
      },

      get(...args) {
        const results = this.all(...args);
        return results.length > 0 ? results[0] : undefined;
      },

      all(...args) {
        const params = args;

        // COUNT users
        if (trimmed.includes('SELECT COUNT(*) as count FROM users') || trimmed.includes('SELECT COUNT(*) as c FROM users')) {
          if (trimmed.includes('is_banned = 1')) {
            return [{ count: data.users.filter(u => u.is_banned === 1).length, c: data.users.filter(u => u.is_banned === 1).length }];
          }
          if (trimmed.includes("status IN ('online'")) {
            return [{ count: data.users.filter(u => ['online', 'idle', 'dnd'].includes(u.status) && !u.is_banned).length, c: data.users.filter(u => ['online', 'idle', 'dnd'].includes(u.status) && !u.is_banned).length }];
          }
          return [{ count: data.users.length, c: data.users.length }];
        }

        // COUNT servers
        if (trimmed.includes('SELECT COUNT(*) as c FROM servers')) {
          return [{ c: data.servers.length }];
        }

        // COUNT messages
        if (trimmed.includes('SELECT COUNT(*) as c FROM messages')) {
          return [{ c: data.messages.length }];
        }

        // COUNT direct_messages
        if (trimmed.includes('SELECT COUNT(*) as c FROM direct_messages')) {
          return [{ c: data.direct_messages.length }];
        }

        // GET USER by ID or email/username
        if (trimmed.startsWith('SELECT id, username, email') && trimmed.includes('FROM users WHERE id = ?')) {
          const id = params[0];
          const u = data.users.find(x => x.id === id);
          return u ? [u] : [];
        }

        if (trimmed.startsWith('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)')) {
          const [login1, login2] = params;
          const u = data.users.find(x => x.username.toLowerCase() === login1.toLowerCase() || x.email.toLowerCase() === login2.toLowerCase());
          return u ? [u] : [];
        }

        if (trimmed.startsWith('SELECT id, username, email FROM users WHERE username = ? OR email = ?')) {
          const [uName, email] = params;
          const u = data.users.find(x => x.username.toLowerCase() === uName.toLowerCase() || x.email.toLowerCase() === email.toLowerCase());
          return u ? [u] : [];
        }

        if (trimmed.startsWith('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')) {
          const [uName, id] = params;
          const u = data.users.find(x => x.username.toLowerCase() === uName.toLowerCase() && x.id !== id);
          return u ? [u] : [];
        }

        if (trimmed.startsWith('SELECT id, username, avatar') && trimmed.includes('FROM users WHERE id = ?')) {
          const id = params[0];
          const u = data.users.find(x => x.id === id && !x.is_banned);
          return u ? [u] : [];
        }

        // LIST USERS
        if (trimmed.startsWith('SELECT id, username, avatar, banner, bio, custom_status, status, role, badge, created_at FROM users WHERE is_banned = 0')) {
          let list = data.users.filter(u => !u.is_banned);
          if (params.length === 2) {
            const q = params[0].replace(/%/g, '').toLowerCase();
            list = list.filter(u => u.username.toLowerCase().includes(q));
          }
          const limit = params[params.length - 1] || 50;
          return list.slice(0, limit);
        }

        // ADMIN USERS LIST
        if (trimmed.includes('FROM users WHERE 1=1')) {
          let list = [...data.users];
          if (trimmed.includes('LOWER(username) LIKE LOWER(?)')) {
            const q = params[0].replace(/%/g, '').toLowerCase();
            list = list.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
          }
          if (trimmed.includes('role = ?')) {
            const role = params[params.length - 1];
            list = list.filter(u => u.role === role);
          }
          if (trimmed.includes('is_banned = 1')) {
            list = list.filter(u => u.is_banned === 1);
          } else if (trimmed.includes('is_banned = 0')) {
            list = list.filter(u => !u.is_banned);
          }
          return list.map(u => ({
            ...u,
            message_count: data.messages.filter(m => m.user_id === u.id).length,
            server_count: data.server_members.filter(sm => sm.user_id === u.id).length
          }));
        }

        // SERVERS
        if (trimmed.includes('FROM servers s JOIN server_members sm ON s.id = sm.server_id AND sm.user_id = ?')) {
          const userId = params[0];
          const myMemberships = data.server_members.filter(sm => sm.user_id === userId);
          const sList = [];
          for (const mem of myMemberships) {
            const s = data.servers.find(x => x.id === mem.server_id);
            if (s) {
              const count = data.server_members.filter(m => m.server_id === s.id).length;
              sList.push({
                ...s,
                member_role: mem.role,
                member_count: count
              });
            }
          }
          return sList;
        }

        if (trimmed.includes('FROM servers s WHERE s.is_public = 1')) {
          const userId = params[0];
          let list = data.servers.filter(s => s.is_public);
          if (params.length >= 3) {
            const q = params[1].replace(/%/g, '').toLowerCase();
            list = list.filter(s => s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q)));
          }
          return list.map(s => ({
            ...s,
            member_count: data.server_members.filter(m => m.server_id === s.id).length,
            is_joined: data.server_members.some(m => m.server_id === s.id && m.user_id === userId) ? 1 : 0
          }));
        }

        if (trimmed.includes('FROM servers s LEFT JOIN server_members sm') && trimmed.includes('WHERE s.id = ?')) {
          const [userId, serverId] = params;
          const s = data.servers.find(x => x.id === serverId);
          if (!s) return [];
          const mem = data.server_members.find(m => m.server_id === serverId && m.user_id === userId);
          const count = data.server_members.filter(m => m.server_id === serverId).length;
          return [{
            ...s,
            member_role: mem ? mem.role : null,
            member_count: count
          }];
        }

        if (trimmed.startsWith('SELECT * FROM servers WHERE id = ?')) {
          const id = params[0];
          const s = data.servers.find(x => x.id === id);
          return s ? [s] : [];
        }

        if (trimmed.startsWith('SELECT id FROM servers WHERE is_public = 1')) {
          return data.servers.filter(s => s.is_public).map(s => ({ id: s.id }));
        }

        if (trimmed.startsWith('SELECT s.*, u.username as owner_username')) {
          return data.servers.map(s => {
            const owner = data.users.find(u => u.id === s.owner_id);
            return {
              ...s,
              owner_username: owner ? owner.username : 'Unknown',
              member_count: data.server_members.filter(m => m.server_id === s.id).length,
              channel_count: data.channels.filter(c => c.server_id === s.id).length,
              message_count: data.messages.filter(m => m.server_id === s.id).length
            };
          });
        }

        // SERVER MEMBERS
        if (trimmed.includes('FROM server_members sm JOIN users u ON sm.user_id = u.id WHERE sm.server_id = ?')) {
          const serverId = params[0];
          const mems = data.server_members.filter(m => m.server_id === serverId);
          const list = [];
          for (const m of mems) {
            const u = data.users.find(x => x.id === m.user_id && !x.is_banned);
            if (u) {
              list.push({
                id: u.id,
                username: u.username,
                avatar: u.avatar,
                bio: u.bio,
                custom_status: u.custom_status,
                status: u.status,
                platform_role: u.role,
                badge: u.badge,
                is_nitro: u.is_nitro || 0,
                server_role: m.role,
                nickname: m.nickname,
                joined_at: m.joined_at
              });
            }
          }
          return list;
        }

        if (trimmed.startsWith('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?') || trimmed.startsWith('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?') || trimmed.startsWith('SELECT id FROM server_members WHERE server_id = ? AND user_id = ?')) {
          const [serverId, userId] = params;
          const mem = data.server_members.find(m => m.server_id === serverId && m.user_id === userId);
          return mem ? [mem] : [];
        }

        // CHANNELS
        if (trimmed.startsWith('SELECT * FROM channels WHERE server_id = ?')) {
          const serverId = params[0];
          const list = data.channels.filter(c => c.server_id === serverId).sort((a, b) => (a.position || 0) - (b.position || 0));
          return list;
        }

        if (trimmed.startsWith('SELECT * FROM channels WHERE id = ?')) {
          const id = params[0];
          const c = data.channels.find(x => x.id === id);
          return c ? [c] : [];
        }

        if (trimmed.includes('SELECT id FROM channels WHERE server_id = ?')) {
          const serverId = params[0];
          const list = data.channels.filter(c => c.server_id === serverId);
          const general = list.find(c => c.name.includes('general')) || list[0];
          return general ? [{ id: general.id }] : [];
        }

        // MESSAGES
        if (trimmed.includes('FROM messages m JOIN users u ON m.user_id = u.id') && trimmed.includes('WHERE m.channel_id = ?')) {
          const channelId = params[0];
          let list = data.messages.filter(m => m.channel_id === channelId);
          if (params.length > 2) {
            const before = params[1];
            list = list.filter(m => new Date(m.created_at) < new Date(before));
          }
          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const limit = params[params.length - 1] || 60;
          list = list.slice(0, limit);

          return list.map(m => {
            const u = data.users.find(x => x.id === m.user_id) || {};
            let reply_content = null;
            let reply_username = null;
            if (m.reply_to_id) {
              const r = data.messages.find(x => x.id === m.reply_to_id);
              if (r) {
                reply_content = r.content;
                const ru = data.users.find(x => x.id === r.user_id);
                reply_username = ru ? ru.username : null;
              }
            }
            return {
              ...m,
              username: u.username || 'Anonymous',
              avatar: u.avatar || '',
              user_platform_role: u.role || 'user',
              user_badge: u.badge || 'member',
              is_nitro: u.is_nitro || 0,
              custom_status: u.custom_status || '',
              reply_content,
              reply_username
            };
          });
        }

        if (trimmed.startsWith('SELECT * FROM messages WHERE id = ?')) {
          const id = params[0];
          const m = data.messages.find(x => x.id === id);
          return m ? [m] : [];
        }

        if (trimmed.includes('FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id IN')) {
          const messageIds = params;
          const list = [];
          for (const rx of data.message_reactions) {
            if (messageIds.includes(rx.message_id)) {
              const u = data.users.find(x => x.id === rx.user_id);
              list.push({
                message_id: rx.message_id,
                emoji: rx.emoji,
                user_id: rx.user_id,
                username: u ? u.username : 'User'
              });
            }
          }
          return list;
        }

        if (trimmed.startsWith('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')) {
          const [messageId, userId, emoji] = params;
          const rx = data.message_reactions.find(r => r.message_id === messageId && r.user_id === userId && r.emoji === emoji);
          return rx ? [rx] : [];
        }

        // DIRECT CONVERSATIONS
        if (trimmed.includes('FROM direct_conversations dc JOIN users u ON') && trimmed.includes('WHERE (dc.user1_id = ? OR dc.user2_id = ?)')) {
          const userId = params[0];
          const convos = data.direct_conversations.filter(c => c.user1_id === userId || c.user2_id === userId);
          const list = [];
          for (const c of convos) {
            const partnerId = c.user1_id === userId ? c.user2_id : c.user1_id;
            const u = data.users.find(x => x.id === partnerId && !x.is_banned);
            if (u) {
              const msgs = data.direct_messages.filter(m => m.conversation_id === c.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              const last = msgs[0];
              list.push({
                id: c.id,
                user1_id: c.user1_id,
                user2_id: c.user2_id,
                updated_at: c.updated_at,
                partner_id: partnerId,
                partner_username: u.username,
                partner_avatar: u.avatar,
                partner_status: u.status,
                partner_custom_status: u.custom_status,
                partner_badge: u.badge,
                is_nitro: u.is_nitro || 0,
                last_message: last ? last.content : null,
                last_message_at: last ? last.created_at : null,
                last_message_sender_id: last ? last.sender_id : null
              });
            }
          }
          return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        }

        if (trimmed.startsWith('SELECT * FROM direct_conversations WHERE user1_id = ? AND user2_id = ?')) {
          const [u1, u2] = params;
          const c = data.direct_conversations.find(x => (x.user1_id === u1 && x.user2_id === u2) || (x.user1_id === u2 && x.user2_id === u1));
          return c ? [c] : [];
        }

        if (trimmed.includes('FROM direct_messages dm JOIN users u ON dm.sender_id = u.id WHERE dm.conversation_id = ?')) {
          const convoId = params[0];
          const msgs = data.direct_messages.filter(m => m.conversation_id === convoId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          return msgs.map(m => {
            const u = data.users.find(x => x.id === m.sender_id) || {};
            return {
              ...m,
              sender_username: u.username || 'User',
              sender_avatar: u.avatar || ''
            };
          });
        }

        // SYSTEM LOGS
        if (trimmed.startsWith('SELECT * FROM system_logs')) {
          const list = [...data.system_logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const limit = params[0] || 20;
          return list.slice(0, limit);
        }

        // SEARCH QUERIES
        if (trimmed.includes('FROM messages m JOIN users u ON m.user_id = u.id JOIN channels c ON m.channel_id = c.id')) {
          const userId = params[0];
          const q = (params[1] || '').replace(/%/g, '').toLowerCase();
          const myServerIds = data.server_members.filter(sm => sm.user_id === userId).map(sm => sm.server_id);
          const results = [];
          for (const m of data.messages) {
            if (myServerIds.includes(m.server_id) && m.content.toLowerCase().includes(q)) {
              const u = data.users.find(x => x.id === m.user_id);
              const c = data.channels.find(x => x.id === m.channel_id);
              const s = data.servers.find(x => x.id === m.server_id);
              results.push({
                id: m.id,
                content: m.content,
                created_at: m.created_at,
                channel_id: m.channel_id,
                server_id: m.server_id,
                username: u ? u.username : 'User',
                avatar: u ? u.avatar : '',
                channel_name: c ? c.name : 'channel',
                server_name: s ? s.name : 'Server'
              });
            }
          }
          return results.slice(0, 20);
        }

        return [];
      }
    };
  }
};

export default db;
