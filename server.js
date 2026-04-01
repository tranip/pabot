require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const Anthropic    = require('@anthropic-ai/sdk');
const webpush      = require('web-push');
const fs           = require('fs');
const path         = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;  // Railway sets PORT automatically
app.set('trust proxy', 1);               // required for rate limiter behind Railway's proxy
const client = new Anthropic.default({ apiKey: process.env.CLAUDE_API_KEY });

// ── Push Notification Setup (VAPID) ──
// VAPID = Voluntary Application Server Identification — proves to the push
// service that notifications are coming from your server, not a third party.
// Keys are generated once with: node generate-vapid.js
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@pabot.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Reminder + Subscription File Paths ──
// Flat JSON files — simple persistence without a database
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');
const REMINDERS_FILE     = path.join(__dirname, 'reminders.json');

function readJSON(file, fallback = []) {
  try   { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Security Middleware ──
// CSP disabled for local development — configure before deploying to production
app.use(helmet({ contentSecurityPolicy: false }));

// cors allows the browser to talk to this server
app.use(cors());

// parse incoming JSON request bodies
app.use(express.json());

// rate limiter — max 30 requests per minute per IP
// protects against accidental runaway loops and abuse draining your API credits
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 30,
  message: { error: 'Too many requests. Slow down.' }
});
app.use('/chat', limiter);

// ── Load Personal Context ──
// This is the file that tells Claude who you are and how to interpret your messages
function loadContext() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'context.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Build System Prompt ──
// Claude's only job is extraction — it figures out WHAT and WHEN.
// The server handles all intent logic (past vs future, reminder vs task).
function buildSystemPrompt(context) {
  return `You are a data extraction assistant for a personal assistant app.

Extract structured information from the user's message and return it as JSON.
You are not a conversational assistant. You do not ask questions or give advice.
You only extract and return data.

== USER CONTEXT (use this to resolve relative times) ==
Timezone: ${context.timezone || 'UTC'}
Work days: ${context.work_schedule?.days?.join(', ') || 'Thu-Mon'}
Shift end time: ${context.work_schedule?.shift_end || '13:30'}
Habits: ${context.habits?.join('. ') || ''}

== TIME RESOLUTION RULES ==
- "after work" = shift end time (${context.work_schedule?.shift_end || '13:30'}) on the relevant day
- "tomorrow morning" = 09:00 next day
- "tonight" = 20:00 same day
- "in X hours/minutes" = calculated from current time
- All times in timezone: ${context.timezone || 'UTC'}
- Past dates are valid — extract them exactly as stated
- ALWAYS output datetime in UTC with Z suffix (e.g. 2026-04-01T22:53:00Z)
- Convert from the user's local timezone to UTC before outputting

== OUTPUT FIELDS ==
- type: "task" | "journal" | "chat"
  - task = anything to do or remember, with or without a time
  - journal = thoughts, feelings, reflections, logging what happened
  - chat = questions, conversation, anything else
- text: the task description or journal entry or chat message (required)
- datetime: ISO 8601 string if a date/time was mentioned, otherwise null
- reply: one short sentence confirming what was extracted (friendly, direct)

Current date/time will be in the user message.`;
}

// ── Determine intent from Claude's extraction ──
// This is where the app logic lives — NOT in the prompt
function resolveIntent(extracted) {
  if (extracted.type === 'journal') return 'create_journal';
  if (extracted.type === 'chat')    return 'general_chat';

  // It's a task — decide if it's a future reminder or a logged task
  if (extracted.datetime) {
    const when = new Date(extracted.datetime);
    const now  = new Date();
    if (when > now) {
      return 'set_reminder';  // future → schedule a notification
    } else {
      return 'create_task';   // past → log it without notification
    }
  }
  return 'create_task'; // no time = plain task
}

// ── Frontend Static Files ──
// Serve only the specific frontend files — never expose .env, server.js, etc.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js',     (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/sw.js', (req, res) => {
  // The Service-Worker-Allowed header lets the SW control the full origin scope
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// ── Routes ──

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'PABot server is running.' });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  // Input validation
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required and must be a string.' });
  }
  if (message.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message too long. Max 2000 characters.' });
  }

  try {
    const context      = loadContext();
    const systemPrompt = buildSystemPrompt(context);
    const now          = new Date().toLocaleString('en-CA', { timeZone: context.timezone || 'UTC' });

    // Force structured JSON output — Claude cannot return conversational text
    const response = await client.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: `Current date/time: ${now}\n\nMessage: ${message}` }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              type:     { type: 'string', enum: ['task', 'journal', 'chat'] },
              text:     { type: 'string' },
              datetime: { type: ['string', 'null'] },
              reply:    { type: 'string' }
            },
            required: ['type', 'text', 'reply'],
            additionalProperties: false
          }
        }
      }
    });

    const rawText  = response.content.find(b => b.type === 'text')?.text || '{}';
    const extracted = JSON.parse(rawText);

    // Server decides the intent — no Claude judgment involved
    const intent = resolveIntent(extracted);

    const result = {
      intent,
      reply:          extracted.reply,
      task_text:      extracted.type === 'task'    ? extracted.text : undefined,
      journal_text:   extracted.type === 'journal' ? extracted.text : undefined,
      reminder_iso:   extracted.datetime || undefined,
      reminder_label: extracted.type === 'task'    ? extracted.text : undefined,
    };

    console.log(`[chat] intent=${intent} datetime=${extracted.datetime || 'null'}`);
    res.json(result);

  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: 'Failed to process your message. Try again.' });
  }
});

// ── Push Notification Routes ──

// Frontend fetches the public VAPID key to set up its push subscription
app.get('/push/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications not configured. Run: node generate-vapid.js' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Browser sends its push subscription object here after the user grants permission.
// We store it so the server can send notifications later.
app.post('/push/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object.' });
  }

  const subs = readJSON(SUBSCRIPTIONS_FILE);
  if (!subs.find(s => s.endpoint === subscription.endpoint)) {
    subs.push(subscription);
    writeJSON(SUBSCRIPTIONS_FILE, subs);
    console.log(`[push] new subscription saved (total: ${subs.length})`);
  } else {
    console.log(`[push] subscription already exists (total: ${subs.length})`);
  }

  res.json({ ok: true });
});

// When a reminder is created on the frontend, it registers it here so the
// server can fire the notification at the right time (even if the tab is closed)
app.post('/reminders', (req, res) => {
  const { id, title, reminder_iso } = req.body;
  if (!title || !reminder_iso) {
    return res.status(400).json({ error: 'title and reminder_iso are required.' });
  }

  const reminders = readJSON(REMINDERS_FILE);
  reminders.push({
    id:           id || Date.now().toString(36),
    title,
    reminder_iso,
    sent:         false,
    created_at:   new Date().toISOString()
  });
  writeJSON(REMINDERS_FILE, reminders);
  console.log(`[reminder] saved: "${title}" at ${reminder_iso}`);

  res.json({ ok: true });
});

// ── Reminder Scheduler ──
// Runs every 60 seconds. Finds reminders whose time has arrived and
// fires a push notification to every stored subscription.
setInterval(async () => {
  const reminders = readJSON(REMINDERS_FILE);
  const subs      = readJSON(SUBSCRIPTIONS_FILE);

  if (!subs.length || !reminders.length) return;

  const now     = new Date();
  let   changed = false;

  for (const reminder of reminders) {
    if (reminder.sent) continue;
    if (new Date(reminder.reminder_iso) > now) continue;

    const payload = JSON.stringify({
      title: 'PABot Reminder',
      body:  reminder.title
    });

    // Push to every stored subscription (just one device for now, more later)
    for (const sub of [...subs]) {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        // 410 Gone = subscription expired or user unsubscribed — remove it
        if (err.statusCode === 410) {
          const idx = subs.findIndex(s => s.endpoint === sub.endpoint);
          if (idx !== -1) subs.splice(idx, 1);
          writeJSON(SUBSCRIPTIONS_FILE, subs);
        } else {
          console.error('Push send failed:', err.message);
        }
      }
    }

    reminder.sent = true;
    changed       = true;
    console.log(`[reminder fired] ${reminder.title} (${reminder.reminder_iso})`);
  }

  if (changed) writeJSON(REMINDERS_FILE, reminders);
}, 60 * 1000);

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`PABot server running at http://localhost:${PORT}`);
  console.log(`API key loaded: ${process.env.CLAUDE_API_KEY ? 'YES' : 'NO — check your .env file'}`);
});
