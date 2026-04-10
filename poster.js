const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { CronJob } = require('cron');
const http = require('http');

// === CONFIG ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!GROQ_API_KEY || !ZERNIO_API_KEY || !TELEGRAM_TOKEN || !ADMIN_CHAT_ID) {
  console.error('Missing env vars: GROQ_API_KEY, ZERNIO_API_KEY, TELEGRAM_TOKEN, ADMIN_CHAT_ID');
  process.exit(1);
}

// === LINKED ACCOUNTS ===
const ACCOUNTS = {
  facebook: process.env.ZERNIO_FACEBOOK_ID || '',
  instagram: process.env.ZERNIO_INSTAGRAM_ID || '',
  pinterest: process.env.ZERNIO_PINTEREST_ID || '',
  tiktok: process.env.ZERNIO_TIKTOK_ID || ''
};

// === TELEGRAM BOT (separate from Linklet support bot — uses same token but different purpose) ===
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Store pending posts waiting for approval
const pendingPosts = new Map();

// === CONTENT TOPICS ===
const TOPICS = [
  "Why students should use Linklet to sell their old textbooks and notes",
  "How Linklet makes it easy to find cheap electronics on campus",
  "Moving out of your hostel? Sell your furniture on Linklet instead of throwing it away",
  "Linklet is completely free — no listing fees, no commission, just students helping students",
  "Looking for a laptop, phone, or charger? Check Linklet before going to the shops",
  "Why campus marketplaces like Linklet are the future of student commerce in Kenya",
  "Sell your clothes, shoes, and accessories on Linklet — your campus closet sale",
  "Start your semester right — find affordable second-hand items on Linklet",
  "M-Pesa payments make buying on Linklet safe and easy",
  "Linklet tip: good photos and honest descriptions help you sell faster",
  "End of semester? Cash in on stuff you no longer need — list it on Linklet",
  "Linklet connects you directly with buyers and sellers on your campus — no middleman",
  "Students are already trading on Linklet — join the community at www.linklet.co.ke",
  "From dorm room to marketplace: how students are making money with Linklet",
  "Need something? Before you buy new, check what fellow students are selling on Linklet",
  "Linklet is built by a student, for students — and it's growing every day",
  "Your old gaming console or speaker could be someone else's treasure — list it on Linklet",
  "Campus hustle made easy: buy low, sell smart on Linklet",
  "Why walk to town when you can find what you need from a student nearby on Linklet?",
  "Linklet: where every Kenyan campus student can be an entrepreneur",
  "Stop scrolling, start selling — your stuff has value on Linklet",
  "The easiest way to make extra cash as a student? Sell on Linklet",
  "Linklet makes campus trading simple — no fees, no hassle, just connect and trade",
  "Looking for affordable study materials? Students sell notes and books on Linklet daily",
  "Your campus, your marketplace — Linklet brings students together to buy and sell",
  "Declutter your room and make money — list anything on Linklet in under 2 minutes",
  "Linklet is growing across Kenyan universities — are you in yet?",
  "Safe, simple, student-powered — that's Linklet",
  "From phones to furniture, students find the best deals on Linklet",
  "Join hundreds of students already buying and selling on Linklet — it's free to start"
];

function getTodaysTopic() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return TOPICS[dayOfYear % TOPICS.length];
}

// === AI CONTENT GENERATION ===
async function generatePost(feedback) {
  const topic = getTodaysTopic();

  let extraInstruction = '';
  if (feedback) {
    extraInstruction = `\n\nIMPORTANT: The previous version was rejected. Here's the feedback: "${feedback}". Write a completely different post that addresses this feedback.`;
  }

  const prompt = `You are a social media manager for Linklet (www.linklet.co.ke) — a free campus marketplace where Kenyan university students buy, sell, and trade items.

Write a social media post about: "${topic}"

Rules:
- 2-4 sentences max, conversational and engaging
- MUST include www.linklet.co.ke
- Write for Kenyan university students
- Sound like a real student, not a brand
- Include 1-2 relevant emojis
- End with a clear call to action
- Add 3-5 relevant hashtags at the end
- Never use "revolutionize", "game-changer", or "unleash"
${extraInstruction}

Return ONLY the post text, nothing else.`;

  try {
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You write authentic, engaging social media posts for Kenyan students. Return only the post text.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.9
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('Groq error:', error.response?.data || error.message);
    return null;
  }
}

// === POST TO ALL PLATFORMS VIA ZERNIO ===
async function postToAll(content) {
  const platforms = [
    { platform: 'facebook', accountId: ACCOUNTS.facebook },
    { platform: 'instagram', accountId: ACCOUNTS.instagram },
    { platform: 'pinterest', accountId: ACCOUNTS.pinterest }
  ];

  try {
    const response = await axios.post('https://zernio.com/api/v1/posts', {
      content,
      platforms,
      publishNow: true,
      mediaItems: [{ type: 'image', url: 'https://www.linklet.co.ke/logo512.png' }]
    }, {
      headers: {
        'Authorization': `Bearer ${ZERNIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Zernio error:', error.response?.data || error.message);
    return null;
  }
}

// === SEND POST FOR APPROVAL ===
async function sendForApproval(content, attempt) {
  const postId = Date.now().toString();

  pendingPosts.set(postId, { content, attempt: attempt || 1 });

  const message = `📝 *New Post for Approval*\n\n${content}\n\n_(Attempt ${attempt || 1})_`;

  await bot.sendMessage(ADMIN_CHAT_ID, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve & Post', callback_data: `approve_${postId}` },
          { text: '❌ Reject', callback_data: `reject_${postId}` }
        ],
        [
          { text: '🔄 Regenerate (new version)', callback_data: `regen_${postId}` }
        ]
      ]
    }
  });

  console.log(`[${new Date().toLocaleTimeString()}] Sent post for approval (ID: ${postId})`);
}

// === HANDLE APPROVAL BUTTONS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  // Only allow admin
  if (chatId.toString() !== ADMIN_CHAT_ID.toString()) return;

  const data = query.data;

  // Handle TikTok video buttons
  if (data.startsWith('tiktok_') || data.startsWith('tiktokai_') || data.startsWith('tikcancel_') || data.startsWith('tikcustom_')) {
    const videoId = data.split('_').slice(1).join('_');
    const videoData = pendingPosts.get(`video_${videoId}`);

    if (!videoData) {
      await bot.answerCallbackQuery(query.id, { text: 'Video expired' });
      return;
    }

    if (data.startsWith('tikcancel_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
      await bot.editMessageText('❌ TikTok post cancelled.', { chat_id: chatId, message_id: query.message.message_id });
      pendingPosts.delete(`video_${videoId}`);
      return;
    }

    if (data.startsWith('tiktokai_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Generating caption...' });
      const aiCaption = await generateTikTokCaption();
      videoData.caption = aiCaption;
      await bot.editMessageText(`🤖 *AI Caption:*\n${aiCaption}\n\n_Approve or type your own caption:_`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Post with this caption', callback_data: `tiktok_${videoId}` },
              { text: '✏️ Type my own', callback_data: `tikcustom_${videoId}` }
            ]
          ]
        }
      });
      return;
    }

    if (data.startsWith('tikcustom_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Type your caption' });
      await bot.editMessageText('✏️ Type your TikTok caption now:', { chat_id: chatId, message_id: query.message.message_id });
      pendingPosts.set('awaiting_tik_caption', { videoId });
      return;
    }

    // tiktok_ — post it
    await bot.answerCallbackQuery(query.id, { text: 'Posting...' });
    await bot.editMessageText('🚀 *Posting to TikTok...*', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });

    const caption = videoData.caption || 'Check out Linklet — the free campus marketplace! www.linklet.co.ke #LinkletKe';
    const result = await postVideoToTikTok(videoData.fileId, caption);

    if (result) {
      const url = result.post?.platforms?.[0]?.platformPostUrl || '';
      await bot.sendMessage(chatId, `🎉 *Posted to TikTok!*\n${url}`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, '⚠️ TikTok posting failed. Check logs.');
    }
    pendingPosts.delete(`video_${videoId}`);
    return;
  }

  const [action, postId] = data.split('_');
  const pending = pendingPosts.get(postId);

  if (!pending) {
    await bot.answerCallbackQuery(query.id, { text: 'Post expired or already handled' });
    return;
  }

  if (action === 'approve') {
    await bot.answerCallbackQuery(query.id, { text: 'Publishing...' });
    await bot.editMessageText(`✅ *APPROVED & PUBLISHING*\n\n${pending.content}`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });

    console.log(`[${new Date().toLocaleTimeString()}] Post approved! Publishing...`);
    const result = await postToAll(pending.content);

    if (result) {
      const urls = (result.post?.platforms || [])
        .filter(p => p.platformPostUrl)
        .map(p => `${p.platform}: ${p.platformPostUrl}`)
        .join('\n');

      await bot.sendMessage(chatId, `🎉 *Posted successfully!*\n\n${urls || 'Published to all platforms'}`, {
        parse_mode: 'Markdown'
      });
    } else {
      await bot.sendMessage(chatId, '⚠️ Publishing failed. Check the logs.');
    }

    pendingPosts.delete(postId);

  } else if (action === 'reject') {
    await bot.answerCallbackQuery(query.id, { text: 'Send your feedback' });
    await bot.editMessageText(`❌ *REJECTED*\n\n${pending.content}\n\n_Reply with your feedback and I'll generate a new version._`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });

    // Store that we're waiting for feedback
    pendingPosts.set('awaiting_feedback', { postId, attempt: pending.attempt });
    pendingPosts.delete(postId);

  } else if (action === 'regen') {
    await bot.answerCallbackQuery(query.id, { text: 'Regenerating...' });
    await bot.editMessageText(`🔄 *REGENERATING*\n\n_Creating a new version..._`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });

    pendingPosts.delete(postId);

    const newContent = await generatePost();
    if (newContent) {
      await sendForApproval(newContent, pending.attempt + 1);
    } else {
      await bot.sendMessage(chatId, '⚠️ Failed to generate new content. Try again later.');
    }
  }
});

// === HANDLE VIDEO MESSAGES (TikTok posting) ===
bot.on('video', async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;

  const fileId = msg.video.file_id;
  const caption = msg.caption || '';

  // Store video info and ask for confirmation
  const videoId = Date.now().toString();
  pendingPosts.set(`video_${videoId}`, { fileId, caption });

  let message = `🎬 *TikTok Video Ready*\n\n`;
  if (caption) {
    message += `Caption: ${caption}\n\n`;
    message += `_Post with this caption or generate an AI caption?_`;
  } else {
    message += `_No caption provided. I'll generate one for you, or you can type your own._`;
  }

  await bot.sendMessage(msg.chat.id, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 Post to TikTok', callback_data: `tiktok_${videoId}` },
          { text: '🤖 AI Caption', callback_data: `tiktokai_${videoId}` }
        ],
        [
          { text: '❌ Cancel', callback_data: `tikcancel_${videoId}` }
        ]
      ]
    }
  });
});

// === POST VIDEO TO TIKTOK VIA ZERNIO ===
async function postVideoToTikTok(fileId, caption) {
  // Get the file URL from Telegram
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

  try {
    const response = await axios.post('https://zernio.com/api/v1/posts', {
      content: caption,
      platforms: [{ platform: 'tiktok', accountId: ACCOUNTS.tiktok }],
      publishNow: true,
      mediaItems: [{ type: 'video', url: fileUrl }]
    }, {
      headers: {
        'Authorization': `Bearer ${ZERNIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('TikTok post response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('TikTok post error:', error.response?.data || error.message);
    return null;
  }
}

// === GENERATE TIKTOK CAPTION ===
async function generateTikTokCaption() {
  const topic = getTodaysTopic();
  try {
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You write viral TikTok captions for Kenyan students. Short, punchy, trendy. Return only the caption.' },
        { role: 'user', content: `Write a TikTok caption about Linklet (www.linklet.co.ke) — a free campus marketplace for Kenyan students. Topic: "${topic}". Max 150 chars. Include 2-3 hashtags. Be trendy and relatable.` }
      ],
      max_tokens: 100,
      temperature: 0.9
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    return 'Check out Linklet — the free campus marketplace! www.linklet.co.ke #LinkletKe #CampusLife';
  }
}

// === HANDLE TIKTOK CALLBACK BUTTONS ===
// (handled in the main callback_query handler below)

// === HANDLE FEEDBACK MESSAGES ===
bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  if (!msg.text || msg.text.startsWith('/')) return;

  // Check if waiting for TikTok custom caption
  const tikCaption = pendingPosts.get('awaiting_tik_caption');
  if (tikCaption) {
    pendingPosts.delete('awaiting_tik_caption');
    const videoData = pendingPosts.get(`video_${tikCaption.videoId}`);
    if (videoData) {
      await bot.sendMessage(msg.chat.id, '🚀 Posting to TikTok...');
      const result = await postVideoToTikTok(videoData.fileId, msg.text);
      if (result) {
        const url = result.post?.platforms?.[0]?.platformPostUrl || '';
        await bot.sendMessage(msg.chat.id, `🎉 *Posted to TikTok!*\n${url}`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(msg.chat.id, '⚠️ TikTok posting failed.');
      }
      pendingPosts.delete(`video_${tikCaption.videoId}`);
    }
    return;
  }

  const awaiting = pendingPosts.get('awaiting_feedback');
  if (!awaiting) return;

  const feedback = msg.text;
  pendingPosts.delete('awaiting_feedback');

  await bot.sendMessage(msg.chat.id, `📝 Got it! Regenerating with your feedback:\n_"${feedback}"_`, {
    parse_mode: 'Markdown'
  });

  console.log(`[${new Date().toLocaleTimeString()}] Feedback received: "${feedback}"`);

  const newContent = await generatePost(feedback);
  if (newContent) {
    await sendForApproval(newContent, awaiting.attempt + 1);
  } else {
    await bot.sendMessage(msg.chat.id, '⚠️ Failed to generate new content.');
  }
});

// === DAILY FLOW: GENERATE → SEND FOR APPROVAL ===
async function dailyPost() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toISOString()}] Generating daily post...`);
  console.log(`Topic: "${getTodaysTopic()}"`);
  console.log('='.repeat(50));

  const content = await generatePost();
  if (!content) {
    console.error('Failed to generate content.');
    await bot.sendMessage(ADMIN_CHAT_ID, '⚠️ Failed to generate today\'s post. Will retry tomorrow.');
    return;
  }

  console.log(`Generated: ${content}\n`);
  await sendForApproval(content, 1);
}

// === MANUAL COMMANDS ===
bot.onText(/\/post/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await bot.sendMessage(msg.chat.id, '📝 Generating a new post...');
  await dailyPost();
});

bot.onText(/\/status/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const pending = pendingPosts.size;
  await bot.sendMessage(msg.chat.id, `📊 *Status*\nPending approvals: ${pending}\nToday's topic: "${getTodaysTopic()}"`, {
    parse_mode: 'Markdown'
  });
});

// === ENTRY POINT ===
const args = process.argv.slice(2);

if (args.includes('--post-now')) {
  // One-shot: generate and send for approval, keep running for button responses
  dailyPost();
} else {
  // Schedule daily at 9 AM EAT (6 AM UTC)
  const job = new CronJob('0 6 * * *', dailyPost, null, true, 'UTC');

  console.log('Linklet Social Media Poster started!');
  console.log('Schedule: 9:00 AM EAT daily');
  console.log('Platforms: Facebook, Instagram, Pinterest');
  console.log('Approval via: Telegram\n');
  console.log('Commands: /post (manual), /status\n');
}

// Health check server for Render
const PORT = process.env.PORT || 3001;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    schedule: '9:00 AM EAT daily',
    platforms: ['facebook', 'instagram', 'pinterest'],
    pendingApprovals: pendingPosts.size,
    todaysTopic: getTodaysTopic()
  }));
}).listen(PORT, () => {
  console.log(`Health check on port ${PORT}`);
});

// Error handling
bot.on('polling_error', (error) => {
  if (error.code !== 'ETELEGRAM' || !error.message.includes('409')) {
    console.error('Polling error:', error.code, error.message);
  }
});
