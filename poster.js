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

// Store custom images sent by admin for future posts
const imageBank = [];
const BACKEND_URL = 'https://api.linklet.co.ke/api';

// === FETCH REAL LISTING IMAGE FROM LINKLET ===
async function getListingImage() {
  try {
    const res = await axios.get(`${BACKEND_URL}/listings?limit=20&sort=newest`);
    const listings = res.data.listings || res.data || [];

    // Find listings with images
    const withImages = listings.filter(l => l.images && l.images.length > 0);
    if (withImages.length === 0) return null;

    // Pick a random one
    const listing = withImages[Math.floor(Math.random() * withImages.length)];
    const image = listing.images[0];

    // Build full URL
    const imageUrl = image.startsWith('http') ? image : `https://api.linklet.co.ke${image}`;

    return {
      url: imageUrl,
      title: listing.title,
      price: listing.price,
      id: listing.id
    };
  } catch (error) {
    console.log('Could not fetch listings:', error.message);
    return null;
  }
}

// === GET BEST IMAGE FOR TODAY'S POST ===
async function getPostImage() {
  // Priority 1: Use a custom image from the bank if available
  if (imageBank.length > 0) {
    const img = imageBank.shift(); // Use and remove from bank
    console.log('Using custom image from bank');
    return { url: img.url, listing: null };
  }

  // Priority 2: Try to fetch a real listing image
  const listing = await getListingImage();
  if (listing) {
    console.log(`Using listing image: "${listing.title}"`);
    return { url: listing.url, listing };
  }

  // Priority 3: Fallback to branded image
  console.log('Fallback to branded image');
  return { url: 'https://www.linklet.co.ke/Linklet_logo.png', listing: null };
}

// === SEMESTER-AWARE TOPICS ===
// Kenyan university calendar (approximate):
// Jan-April: Semester 1 (mid-sem around Feb-March)
// May: End of Sem 1 / Short break
// June-Aug: Semester 2 (mid-sem around July)
// Sept: End of Sem 2
// Oct-Dec: Long break / Some have Sem 3

function getSemesterPeriod() {
  const month = new Date().getMonth(); // 0-11
  const day = new Date().getDate();

  if (month === 0) return 'new_year'; // January
  if (month === 1) return 'early_semester'; // February
  if (month === 2 || month === 3) return 'mid_semester'; // March-April
  if (month === 4) return 'end_semester'; // May
  if (month === 5) return 'early_semester'; // June (Sem 2 start)
  if (month === 6) return 'mid_semester'; // July
  if (month === 7 || month === 8) return 'end_semester'; // Aug-Sep
  if (month === 9) return 'break'; // October
  if (month === 10) return 'break'; // November
  if (month === 11) return 'new_year'; // December
  return 'general';
}

const TOPICS_BY_PERIOD = {
  new_year: [
    "New year, new campus hustle — start selling on Linklet",
    "Planning for next semester? Find affordable second-hand items on Linklet",
    "Got gifts you don't need? Sell them on Linklet and start the year with extra cash",
    "New year resolution: stop overpaying. Check Linklet for student deals first",
    "Back on campus soon? List what you don't need and buy what you do on Linklet"
  ],
  early_semester: [
    "New semester, new needs — find affordable textbooks and supplies on Linklet",
    "Just moved into a new room? Find furniture, electronics, and more from fellow students on Linklet",
    "Looking for a cheap laptop or phone to start the semester? Check Linklet first",
    "Textbook prices are crazy — buy second-hand from fellow students on Linklet instead",
    "Setting up your new hostel room? Students are selling essentials on Linklet right now",
    "Pro tip: before you spend at the shops, check what students are selling on Linklet",
    "New semester energy — buy smart, sell smart on Linklet"
  ],
  mid_semester: [
    "Mid-semester grind is real — need a study lamp, charger, or calculator? Check Linklet",
    "Broke in the middle of the semester? Sell stuff you don't use on Linklet for quick cash",
    "Need study materials? Students sell notes, past papers, and textbooks on Linklet daily",
    "Campus life hack: Linklet has everything from electronics to snacks, sold by students near you",
    "Your charger broke mid-semester? Find a cheap replacement on Linklet before going to town",
    "Mid-sem and running low on cash? List something on Linklet — it sells faster than you think",
    "Looking for affordable meals, supplies, or electronics? Fellow students have you covered on Linklet",
    "That thing sitting in your room collecting dust? Someone on campus wants to buy it — list it on Linklet",
    "Linklet is your campus shortcut — why walk to town when a student nearby has what you need?",
    "Students helping students — that's what Linklet is about. Buy and sell on campus, for free",
    "Need something? Post it on Linklet. Someone on campus probably has it",
    "Linklet tip: good photos and fair prices = fast sales. Try it",
    "Your campus, your marketplace — Linklet connects students who want to buy with students who want to sell"
  ],
  end_semester: [
    "Semester's ending — sell what you won't carry home on Linklet",
    "Moving out of your hostel? Don't throw stuff away — sell it on Linklet",
    "End of semester clearance: list your books, electronics, and furniture on Linklet",
    "Going home for the break? Cash in on items you don't need — list them on Linklet",
    "Last chance to sell before the break — list your items on Linklet today",
    "Don't leave money on the table — sell your semester stuff on Linklet before you go",
    "That mattress, kettle, or iron you won't need next semester? Someone will buy it on Linklet"
  ],
  break: [
    "On break but still hustling — list items on Linklet and sell to students heading back early",
    "Use the break to set up your Linklet account and be ready to sell when campus opens",
    "Planning for next semester? Browse Linklet now and bookmark what you need",
    "Break time hustle: buy low on Linklet now, sell when demand is high next semester",
    "Linklet doesn't stop during the break — students are still trading. Are you?"
  ]
};

// General topics that work anytime
const GENERAL_TOPICS = [
  "Linklet is completely free — no listing fees, no commission, just students helping students",
  "M-Pesa payments make buying on Linklet safe and easy",
  "Linklet connects you directly with buyers and sellers on your campus — no middleman",
  "Students are already trading on Linklet — join the community at www.linklet.co.ke",
  "Linklet is built by a student, for students — and it's growing every day",
  "Campus hustle made easy: buy low, sell smart on Linklet",
  "Linklet is growing across Kenyan universities — are you in yet?",
  "Safe, simple, student-powered — that's Linklet",
  "Linklet: where every Kenyan campus student can be an entrepreneur",
  "Why walk to town when you can find what you need from a student nearby on Linklet?"
];

function getTodaysTopic() {
  const period = getSemesterPeriod();
  const periodTopics = TOPICS_BY_PERIOD[period] || GENERAL_TOPICS;

  // Combine period-specific + general topics, weighted toward period-specific
  const allTopics = [...periodTopics, ...periodTopics, ...GENERAL_TOPICS];

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return allTopics[dayOfYear % allTopics.length];
}

// === AI CONTENT GENERATION ===
async function generatePost(feedback, listingContext) {
  const topic = getTodaysTopic();

  let extraInstruction = '';
  if (feedback) {
    extraInstruction = `\n\nIMPORTANT: The previous version was rejected. Here's the feedback: "${feedback}". Write a completely different post that addresses this feedback.`;
  }
  if (listingContext) {
    extraInstruction += listingContext;
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

// === GENERATE POST FROM CUSTOM TOPIC ===
async function generateCustomPost(customTopic) {
  const prompt = `You are a social media manager for Linklet (www.linklet.co.ke) — a free campus marketplace where Kenyan university students buy, sell, and trade items.

Write a social media post about: "${customTopic}"

Rules:
- 2-4 sentences max, conversational and engaging
- MUST include www.linklet.co.ke
- Write for Kenyan university students
- Sound like a real student, not a brand
- Include 1-2 relevant emojis
- End with a clear call to action
- Add 3-5 relevant hashtags at the end
- Never use "revolutionize", "game-changer", or "unleash"

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
async function postToAll(content, imageUrl) {
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
      mediaItems: [{ type: 'image', url: imageUrl }]
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
async function sendForApproval(content, attempt, imageUrl) {
  const postId = Date.now().toString();

  pendingPosts.set(postId, { content, attempt: attempt || 1, imageUrl });

  const message = `📝 *New Post for Approval*\n\n${content}\n\n🖼 Image: ${imageUrl || 'logo'}\n_(Attempt ${attempt || 1})_`;

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

  // Handle video buttons
  if (data.startsWith('vid')) {
    const videoId = data.split('_').slice(1).join('_');
    const videoData = pendingPosts.get(`video_${videoId}`);

    if (!videoData) {
      await bot.answerCallbackQuery(query.id, { text: 'Video expired' });
      return;
    }

    if (data.startsWith('vidcancel_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
      await bot.editMessageText('❌ Video post cancelled.', { chat_id: chatId, message_id: query.message.message_id });
      pendingPosts.delete(`video_${videoId}`);
      return;
    }

    if (data.startsWith('vidai_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Generating caption...' });
      const aiCaption = await generateTikTokCaption();
      videoData.caption = aiCaption;
      await bot.editMessageText(`🤖 *AI Caption:*\n${aiCaption}\n\n_Post with this or type your own:_`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 All Platforms', callback_data: `vidall_${videoId}` }
            ],
            [
              { text: '📱 TikTok', callback_data: `vidtiktok_${videoId}` },
              { text: '📸 Instagram', callback_data: `vidinsta_${videoId}` },
              { text: '📘 Facebook', callback_data: `vidfb_${videoId}` }
            ],
            [
              { text: '✏️ Type my own', callback_data: `vidcustom_${videoId}` }
            ]
          ]
        }
      });
      return;
    }

    if (data.startsWith('vidcustom_')) {
      await bot.answerCallbackQuery(query.id, { text: 'Type your caption' });
      await bot.editMessageText('✏️ Type your caption now:', { chat_id: chatId, message_id: query.message.message_id });
      pendingPosts.set('awaiting_tik_caption', { videoId });
      return;
    }

    // Determine target platforms
    let targets = [];
    let label = '';
    if (data.startsWith('vidall_')) {
      targets = ['tiktok', 'instagram', 'facebook'];
      label = 'TikTok + Instagram + Facebook';
    } else if (data.startsWith('vidtiktok_')) {
      targets = ['tiktok'];
      label = 'TikTok';
    } else if (data.startsWith('vidinsta_')) {
      targets = ['instagram'];
      label = 'Instagram';
    } else if (data.startsWith('vidfb_')) {
      targets = ['facebook'];
      label = 'Facebook';
    }

    await bot.answerCallbackQuery(query.id, { text: 'Posting...' });
    await bot.editMessageText(`🚀 *Posting to ${label}...*`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });

    const caption = videoData.caption || 'Check out Linklet — the free campus marketplace! www.linklet.co.ke #LinkletKe';
    const result = await postVideo(videoData.fileId, caption, targets);

    if (result) {
      const urls = (result.post?.platforms || [])
        .filter(p => p.platformPostUrl)
        .map(p => `${p.platform}: ${p.platformPostUrl}`)
        .join('\n');
      await bot.sendMessage(chatId, `🎉 *Posted to ${label}!*\n\n${urls || 'Published successfully'}`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `⚠️ Failed to post to ${label}.`);
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
    const result = await postToAll(pending.content, pending.imageUrl);

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
    pendingPosts.set('awaiting_feedback', { postId, attempt: pending.attempt, imageUrl: pending.imageUrl });
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
      await sendForApproval(newContent, pending.attempt + 1, pending.imageUrl);
    } else {
      await bot.sendMessage(chatId, '⚠️ Failed to generate new content. Try again later.');
    }
  }
});

// === HANDLE PHOTO MESSAGES (save to image bank) ===
bot.on('photo', async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;

  // Get highest resolution photo
  const photo = msg.photo[msg.photo.length - 1];
  const file = await bot.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

  imageBank.push({ url: fileUrl, addedAt: new Date().toISOString() });

  await bot.sendMessage(msg.chat.id, `🖼 *Image saved!* (${imageBank.length} images in bank)\n\nThis will be used for the next social media post instead of a listing image.`, {
    parse_mode: 'Markdown'
  });

  console.log(`[${new Date().toLocaleTimeString()}] Image added to bank. Total: ${imageBank.length}`);
});

// === HANDLE VIDEO MESSAGES (TikTok posting) ===
bot.on('video', async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;

  const fileId = msg.video.file_id;
  const caption = msg.caption || '';

  // Store video info and ask for confirmation
  const videoId = Date.now().toString();
  pendingPosts.set(`video_${videoId}`, { fileId, caption });

  let message = `🎬 *Video Ready*\n\n`;
  if (caption) {
    message += `Caption: ${caption}\n\n`;
  }
  message += `_Where do you want to post this?_`;

  await bot.sendMessage(msg.chat.id, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 All Platforms', callback_data: `vidall_${videoId}` }
        ],
        [
          { text: '📱 TikTok', callback_data: `vidtiktok_${videoId}` },
          { text: '📸 Instagram', callback_data: `vidinsta_${videoId}` },
          { text: '📘 Facebook', callback_data: `vidfb_${videoId}` }
        ],
        [
          { text: '🤖 AI Caption first', callback_data: `vidai_${videoId}` },
          { text: '❌ Cancel', callback_data: `vidcancel_${videoId}` }
        ]
      ]
    }
  });
});

// === POST VIDEO TO PLATFORMS VIA ZERNIO ===
async function postVideo(fileId, caption, targetPlatforms) {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

  const platformMap = {
    tiktok: { platform: 'tiktok', accountId: ACCOUNTS.tiktok },
    instagram: { platform: 'instagram', accountId: ACCOUNTS.instagram },
    facebook: { platform: 'facebook', accountId: ACCOUNTS.facebook }
  };

  const platforms = targetPlatforms.map(p => platformMap[p]).filter(Boolean);

  try {
    const response = await axios.post('https://zernio.com/api/v1/posts', {
      content: caption,
      platforms,
      publishNow: true,
      mediaItems: [{ type: 'video', url: fileUrl }]
    }, {
      headers: {
        'Authorization': `Bearer ${ZERNIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Video post response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Video post error:', error.response?.data || error.message);
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

  // Check if waiting for video custom caption
  const tikCaption = pendingPosts.get('awaiting_tik_caption');
  if (tikCaption) {
    pendingPosts.delete('awaiting_tik_caption');
    const videoData = pendingPosts.get(`video_${tikCaption.videoId}`);
    if (videoData) {
      videoData.caption = msg.text;
      await bot.sendMessage(msg.chat.id, `✅ Caption saved: _"${msg.text}"_\n\nNow pick where to post:`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 All Platforms', callback_data: `vidall_${tikCaption.videoId}` }],
            [
              { text: '📱 TikTok', callback_data: `vidtiktok_${tikCaption.videoId}` },
              { text: '📸 Instagram', callback_data: `vidinsta_${tikCaption.videoId}` },
              { text: '📘 Facebook', callback_data: `vidfb_${tikCaption.videoId}` }
            ]
          ]
        }
      });
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
    await sendForApproval(newContent, awaiting.attempt + 1, awaiting.imageUrl);
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

  // Get image first so we can mention the listing
  const imageData = await getPostImage();
  let listingContext = '';
  if (imageData.listing) {
    listingContext = `\n\nFeatured listing to mention: "${imageData.listing.title}" priced at KSh ${Number(imageData.listing.price).toLocaleString()}. Naturally mention this item in the post.`;
  }

  const content = await generatePost(null, listingContext);
  if (!content) {
    console.error('Failed to generate content.');
    await bot.sendMessage(ADMIN_CHAT_ID, '⚠️ Failed to generate today\'s post. Will retry tomorrow.');
    return;
  }

  console.log(`Generated: ${content}`);
  console.log(`Image: ${imageData.url}\n`);
  await sendForApproval(content, 1, imageData.url);
}

// === MANUAL COMMANDS ===
bot.onText(/\/post/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await bot.sendMessage(msg.chat.id, '📝 Generating a new post...');
  await dailyPost();
});

// Custom topic: /topic back to school deals
bot.onText(/\/topic (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const customTopic = match[1];
  await bot.sendMessage(msg.chat.id, `📝 Generating post about: _"${customTopic}"_`, { parse_mode: 'Markdown' });

  const imageData = await getPostImage();
  const content = await generateCustomPost(customTopic);
  if (content) {
    await sendForApproval(content, 1, imageData.url);
  } else {
    await bot.sendMessage(msg.chat.id, '⚠️ Failed to generate. Try again.');
  }
});

// Direct text: /write your exact post text here
bot.onText(/\/write (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const customText = match[1];
  const imageData = await getPostImage();
  await sendForApproval(customText, 1, imageData.url);
});

// Help
bot.onText(/\/help/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await bot.sendMessage(msg.chat.id, `🤖 *Linklet Social Poster Bot*

*Commands:*
/post — Generate a post (auto topic)
/topic _your idea_ — Generate post about a custom topic
/write _your text_ — Use your exact text as a post
/status — Check pending posts & today's topic
/help — Show this menu

*Media:*
📷 Send a photo — saves it for the next post
🎬 Send a video — post to TikTok

*Approval:*
✅ Approve — publishes to Facebook, Instagram, Pinterest
❌ Reject — give feedback, AI rewrites
🔄 Regenerate — get a fresh version`, { parse_mode: 'Markdown' });
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

// Prevent crashes from unhandled promise rejections (e.g. Telegram 409 on redeploy)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (ignored):', reason?.message || reason);
});

// Graceful shutdown — stop polling before Render kills the process
process.on('SIGTERM', () => {
  console.log('SIGTERM received — stopping bot gracefully...');
  bot.stopPolling().then(() => process.exit(0)).catch(() => process.exit(0));
});
