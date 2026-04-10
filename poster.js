const axios = require('axios');
const { CronJob } = require('cron');
const http = require('http');

// === CONFIG ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;

if (!GROQ_API_KEY || !ZERNIO_API_KEY) {
  console.error('Missing GROQ_API_KEY or ZERNIO_API_KEY');
  process.exit(1);
}

// === LINKED ACCOUNTS (set via env vars or defaults) ===
const ACCOUNTS = {
  facebook: process.env.ZERNIO_FACEBOOK_ID || '',
  instagram: process.env.ZERNIO_INSTAGRAM_ID || '',
  pinterest: process.env.ZERNIO_PINTEREST_ID || '',
  tiktok: process.env.ZERNIO_TIKTOK_ID || ''
};

// === CONTENT TOPICS (rotates daily) ===
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
async function generatePost() {
  const topic = getTodaysTopic();

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
  // Post to Facebook, Instagram, Pinterest (text + image platforms)
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

    console.log('\nZernio response:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Zernio error:', JSON.stringify(error.response?.data || error.message, null, 2));
    return null;
  }
}

// === MAIN ===
async function dailyPost() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toISOString()}] Generating daily post...`);
  console.log(`Topic: "${getTodaysTopic()}"`);
  console.log('='.repeat(50));

  const content = await generatePost();
  if (!content) {
    console.error('Failed to generate content. Skipping.');
    return;
  }

  console.log(`\nGenerated post:\n${content}\n`);
  console.log(`(${content.length} chars)`);

  const result = await postToAll(content);
  if (result) {
    console.log('\nPost published!');
  }
}

// === PREVIEW MODE ===
async function previewPost() {
  console.log('Generating preview (not posting)...\n');
  console.log(`Topic: "${getTodaysTopic()}"\n`);
  const content = await generatePost();
  console.log('--- PREVIEW ---');
  console.log(content);
  console.log(`\n(${content ? content.length : 0} chars)`);
}

// === ENTRY POINT ===
const args = process.argv.slice(2);

if (args.includes('--preview')) {
  previewPost();
} else if (args.includes('--post-now')) {
  dailyPost();
} else {
  // Schedule daily at 9 AM EAT (6 AM UTC)
  const job = new CronJob('0 6 * * *', dailyPost, null, true, 'UTC');

  console.log('Linklet Social Media Poster started!');
  console.log('Schedule: 9:00 AM EAT daily');
  console.log('Platforms: Facebook, Instagram, Pinterest\n');

  // Run once on startup
  console.log('Running initial post...');
  dailyPost();

  // Health check server for Render
  const PORT = process.env.PORT || 3001;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      schedule: '9:00 AM EAT daily',
      platforms: ['facebook', 'instagram', 'pinterest'],
      todaysTopic: getTodaysTopic()
    }));
  }).listen(PORT, () => {
    console.log(`Health check on port ${PORT}`);
  });
}
