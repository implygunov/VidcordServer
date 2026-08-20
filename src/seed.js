import bcrypt from 'bcryptjs';
import db, { initDatabase } from './db.js';

export function seedData() {
  initDatabase();

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) {
    console.log('Database already contains data, skipping initial seed.');
    return;
  }

  console.log('Seeding initial gaming data for VidCord...');

  const passwordHash = bcrypt.hashSync('admin123', 10);
  const userPasswordHash = bcrypt.hashSync('gamer123', 10);

  // 1. Insert Users (Admin + Pro Gamers)
  const users = [
    {
      id: 'usr_admin',
      username: 'VidMaster',
      email: 'admin@vidcord.gg',
      password_hash: passwordHash,
      avatar: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80',
      bio: 'Lead Architect & VidCord Creator. Running the grid.',
      custom_status: '⚡ Building the ultimate gaming matrix',
      status: 'online',
      role: 'admin',
      badge: 'owner',
    },
    {
      id: 'usr_cyber',
      username: 'Netrunner_V',
      email: 'v@nightcity.io',
      password_hash: userPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&auto=format&fit=crop&q=80',
      bio: 'Full sandevistan build. Afterlife regular.',
      custom_status: '🕶️ In Night City (Level 60)',
      status: 'online',
      role: 'moderator',
      badge: 'pro_gamer',
    },
    {
      id: 'usr_val',
      username: 'AcesHigh',
      email: 'jett@radiant.gg',
      password_hash: userPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
      bio: 'Radiant 450RR Jett main. Flash, dash, headshot.',
      custom_status: '🎯 Queued for Competitive',
      status: 'dnd',
      role: 'user',
      badge: 'pro_gamer',
    },
    {
      id: 'usr_tarnished',
      username: 'ShadowLord',
      email: 'tarnished@erdtree.com',
      password_hash: userPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
      bio: 'Shadow of the Erdtree finished at RL1. Ask me for boss tips.',
      custom_status: '⚔️ Helping tarnished with Malenia',
      status: 'idle',
      role: 'user',
      badge: 'early_supporter',
    },
    {
      id: 'usr_gamedev',
      username: 'PixelForge',
      email: 'dev@indieforge.net',
      password_hash: userPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      bio: 'Crafting dark monochrome rogue-likes in Rust & WebGL.',
      custom_status: '💻 Debugging physics engine',
      status: 'online',
      role: 'user',
      badge: 'early_supporter',
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, email, password_hash, avatar, banner, bio, custom_status, status, role, badge)
    VALUES (@id, @username, @email, @password_hash, @avatar, @banner, @bio, @custom_status, @status, @role, @badge)
  `);

  for (const u of users) {
    insertUser.run(u);
  }

  // 2. Insert Gaming Servers
  const servers = [
    {
      id: 'srv_cyberpunk',
      name: 'CYBERPUNK 2077 // AFTERLIFE',
      description: 'The premier monochrome hub for Night City mercs, netrunners and chrome enthusiasts.',
      icon: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=100&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800&auto=format&fit=crop&q=80',
      owner_id: 'usr_admin',
      is_public: 1
    },
    {
      id: 'srv_valorant',
      name: 'VALORANT PRO ESPORTS',
      description: 'Competitive scrims, Radiant LFG, clutch clips and agent strategy breakdowns.',
      icon: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=100&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
      owner_id: 'usr_val',
      is_public: 1
    },
    {
      id: 'srv_elden',
      name: 'ELDEN RING SANCTUARY',
      description: 'Co-op summoning, lore debates, PvP tournament brackets and build guides.',
      icon: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=100&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
      owner_id: 'usr_tarnished',
      is_public: 1
    }
  ];

  const insertServer = db.prepare(`
    INSERT INTO servers (id, name, description, icon, banner, owner_id, is_public)
    VALUES (@id, @name, @description, @icon, @banner, @owner_id, @is_public)
  `);

  for (const s of servers) {
    insertServer.run(s);
  }

  // Add members to servers
  const insertMember = db.prepare(`
    INSERT INTO server_members (id, server_id, user_id, role)
    VALUES (?, ?, ?, ?)
  `);

  for (const s of servers) {
    for (const u of users) {
      const role = u.id === s.owner_id ? 'owner' : (u.role === 'admin' ? 'admin' : (u.role === 'moderator' ? 'moderator' : 'member'));
      insertMember.run(`mem_${s.id}_${u.id}`, s.id, u.id, role);
    }
  }

  // 3. Insert Channels
  const channels = [
    // Cyberpunk channels
    { id: 'chn_cp_welcome', server_id: 'srv_cyberpunk', name: 'welcome-rules', type: 'text', category: 'INFORMATION', topic: 'Welcome to Afterlife! Read guidelines & grab roles.', position: 0 },
    { id: 'chn_cp_general', server_id: 'srv_cyberpunk', name: 'general-chat', type: 'text', category: 'COMMUNITY', topic: 'Main corridor of Night City. Keep it chrome.', position: 1 },
    { id: 'chn_cp_builds', server_id: 'srv_cyberpunk', name: 'cyberware-builds', type: 'text', category: 'COMMUNITY', topic: 'Share your Sandevistan, Netrunner, and Berserk setups.', position: 2 },
    { id: 'chn_cp_clips', server_id: 'srv_cyberpunk', name: 'clips-and-screenshots', type: 'text', category: 'MEDIA', topic: 'Drop your cinematic 4K captures.', position: 3 },
    { id: 'chn_cp_voice', server_id: 'srv_cyberpunk', name: 'Braindance Lounge', type: 'voice', category: 'VOICE CHANNELS', topic: 'High-fidelity audio stream', position: 4 },

    // Valorant channels
    { id: 'chn_val_ann', server_id: 'srv_valorant', name: 'tournaments', type: 'text', category: 'INFORMATION', topic: 'Weekly VidCord 5v5 Cup registration & brackets.', position: 0 },
    { id: 'chn_val_general', server_id: 'srv_valorant', name: 'radiant-lobby', type: 'text', category: 'COMMUNITY', topic: 'Tactical discussions and patch banter.', position: 1 },
    { id: 'chn_val_lfg', server_id: 'srv_valorant', name: 'lfg-scrims', type: 'text', category: 'COMPETITIVE', topic: 'Find teammates Immortal+ and Radiant only.', position: 2 },
    { id: 'chn_val_voice', server_id: 'srv_valorant', name: 'Squad Alpha (5 Man)', type: 'voice', category: 'VOICE CHANNELS', topic: 'Tactical comms', position: 3 },

    // Elden Ring channels
    { id: 'chn_el_general', server_id: 'srv_elden', name: 'roundtable-hold', type: 'text', category: 'COMMUNITY', topic: 'Tarnished gathering point.', position: 0 },
    { id: 'chn_el_coop', server_id: 'srv_elden', name: 'coop-summoning', type: 'text', category: 'GAMEPLAY', topic: 'Drop your password and summoning sign location.', position: 1 },
    { id: 'chn_el_lore', server_id: 'srv_elden', name: 'deep-lore-theories', type: 'text', category: 'LORE', topic: 'Marika, Miquella, and the Lands Between.', position: 2 }
  ];

  const insertChannel = db.prepare(`
    INSERT INTO channels (id, server_id, name, type, category, topic, position)
    VALUES (@id, @server_id, @name, @type, @category, @topic, @position)
  `);

  for (const c of channels) {
    insertChannel.run(c);
  }

  // 4. Insert Authentic Initial Chat Messages
  const messages = [
    {
      id: 'msg_1',
      channel_id: 'chn_cp_welcome',
      server_id: 'srv_cyberpunk',
      user_id: 'usr_admin',
      content: '🚀 **Welcome to VidCord // Cyberpunk Hub!**\n\nEnjoy the ultra-fast monochrome dark gaming interface. Feel free to explore channels, start a conversation, customize your gamer profile, and test real-time omni-search (`Ctrl + K`).',
      is_pinned: 1,
      attachments: '[]'
    },
    {
      id: 'msg_2',
      channel_id: 'chn_cp_general',
      server_id: 'srv_cyberpunk',
      user_id: 'usr_cyber',
      content: 'Just slotted the Militech "Falcon" Sandevistan with 3x heat sinks. The time dilation slowdown feels insane during boss encounters 🔥',
      is_pinned: 0,
      attachments: '[]'
    },
    {
      id: 'msg_3',
      channel_id: 'chn_cp_general',
      server_id: 'srv_cyberpunk',
      user_id: 'usr_gamedev',
      content: 'Check out this snippet for quick matrix calculations in the new physics engine:\n```javascript\nconst sandevistanRatio = 0.15;\nconst playerVelocity = baseSpeed * (1 / sandevistanRatio);\nconsole.log(`Bullet time active: ${playerVelocity} m/s`);\n```\nRuns at constant 144 FPS now!',
      is_pinned: 0,
      attachments: '[]'
    },
    {
      id: 'msg_4',
      channel_id: 'chn_cp_general',
      server_id: 'srv_cyberpunk',
      user_id: 'usr_admin',
      content: 'Super clean! VidCord is running with zero lag on SQLite + WebSocket channels. Check your latency on the top right bar.',
      is_pinned: 0,
      attachments: '[]'
    },
    {
      id: 'msg_5',
      channel_id: 'chn_val_general',
      server_id: 'srv_valorant',
      user_id: 'usr_val',
      content: 'Anyone queuing for competitive? Need 1 controller or initiator for full 5-stack Radiant lobby.',
      is_pinned: 0,
      attachments: '[]'
    }
  ];

  const insertMsg = db.prepare(`
    INSERT INTO messages (id, channel_id, server_id, user_id, content, is_pinned, attachments)
    VALUES (@id, @channel_id, @server_id, @user_id, @content, @is_pinned, @attachments)
  `);

  for (const m of messages) {
    insertMsg.run(m);
  }

  // Add reactions
  const insertReaction = db.prepare(`
    INSERT INTO message_reactions (id, message_id, user_id, emoji)
    VALUES (?, ?, ?, ?)
  `);

  insertReaction.run('rx_1', 'msg_1', 'usr_cyber', '🔥');
  insertReaction.run('rx_2', 'msg_1', 'usr_val', '⚡');
  insertReaction.run('rx_3', 'msg_2', 'usr_admin', '💯');
  insertReaction.run('rx_4', 'msg_3', 'usr_cyber', '🚀');

  // Insert initial DM conversation between Admin and Cyber_V
  db.prepare(`
    INSERT INTO direct_conversations (id, user1_id, user2_id)
    VALUES ('dm_admin_cyber', 'usr_admin', 'usr_cyber')
  `).run();

  db.prepare(`
    INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, content)
    VALUES ('dm_msg_1', 'dm_admin_cyber', 'usr_cyber', 'usr_admin', 'Hey VidMaster! The monochrome UI is looking sick. Let me know when the next tournament starts.')
  `).run();

  db.prepare(`
    INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, content)
    VALUES ('dm_msg_2', 'dm_admin_cyber', 'usr_admin', 'usr_cyber', 'Thanks V! Tournament brackets will be posted in #tournaments today. Stay sharp.')
  `).run();

  // Log system initialization
  db.prepare(`
    INSERT INTO system_logs (id, action, details, user_id)
    VALUES ('log_init', 'SYSTEM_INITIALIZED', 'VidCord security, database, and gaming hubs initialized with monochrome theme presets.', 'usr_admin')
  `).run();

  console.log('✅ Initial gaming seed data created successfully!');
}
