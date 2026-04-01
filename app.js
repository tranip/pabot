// Local dev → localhost. Production → Railway URL (filled in after Railway deployment)
const SERVER = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://REPLACE_WITH_RAILWAY_URL';

// ── Storage ──
// All data lives in localStorage so it persists between sessions without a database

function loadData(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let messages = loadData('pabot_messages', []);
let tasks    = loadData('pabot_tasks', []);
let journals = loadData('pabot_journals', []);

// ── Helpers ──

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(isoString) {
  const d    = new Date(isoString);
  const now  = new Date();
  const diff = now - d;

  const todayStr    = now.toDateString();
  const msgDayStr   = d.toDateString();
  const yesterday   = new Date(now); yesterday.setDate(yesterday.getDate() - 1);

  if (msgDayStr === todayStr)            return 'Today';
  if (msgDayStr === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

function toDateKey(isoString) {
  // Returns YYYY-MM-DD in local time
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayKey() {
  return toDateKey(new Date().toISOString());
}

// ── View Management ──

let currentView = 'chat';

const views = {
  chat:    document.getElementById('chat-view'),
  task:    document.getElementById('task-view'),
  journal: document.getElementById('journal-view'),
};

const headerTitle   = document.getElementById('header-title');
const headerActions = document.getElementById('header-actions');
const btnBack       = document.getElementById('btn-back');
const chatBar       = document.getElementById('chat-bar');

function showView(name) {
  currentView = name;
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });

  if (name === 'chat') {
    headerTitle.textContent = 'PABot';
    btnBack.classList.add('hidden');
    headerActions.style.display = 'flex';
    chatBar.classList.remove('hidden');
  } else {
    headerTitle.textContent = name === 'task' ? 'Tasks' : 'Journal';
    btnBack.classList.remove('hidden');
    headerActions.style.display = 'none';
    chatBar.classList.add('hidden');
  }

  if (name === 'task')    renderTasks();
  if (name === 'journal') renderJournals();
}

document.getElementById('btn-tasks').addEventListener('click', () => showView('task'));
document.getElementById('btn-journal').addEventListener('click', () => showView('journal'));
btnBack.addEventListener('click', () => showView('chat'));

// ── Chat Rendering ──

const messageList = document.getElementById('message-list');

function renderMessages() {
  messageList.innerHTML = '';

  if (messages.length === 0) {
    // Welcome message on first load
    addBotBubble('Hey — I\'m PABot. Tell me what\'s on your mind. You can add tasks, set reminders, or write journal entries just by typing naturally.', new Date().toISOString(), false);
    return;
  }

  let lastSender = null;
  let lastDateLabel = null;

  messages.forEach((msg) => {
    const dateLabel = formatDate(msg.timestamp);

    // Insert date separator when the day changes
    if (dateLabel !== lastDateLabel) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.textContent = dateLabel;
      messageList.appendChild(sep);
      lastDateLabel = dateLabel;
    }

    const isNewSender = msg.role !== lastSender;
    renderBubble(msg, isNewSender);
    lastSender = msg.role;
  });

  scrollToBottom();
}

function renderBubble(msg, isNewSender) {
  const row = document.createElement('div');
  row.className = `msg-row ${msg.role}${isNewSender ? ' new-sender' : ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = msg.text;

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(msg.timestamp);

  row.appendChild(bubble);
  row.appendChild(time);
  messageList.appendChild(row);
}

function addUserBubble(text) {
  const msg = { id: genId(), role: 'user', text, timestamp: new Date().toISOString() };
  messages.push(msg);
  saveData('pabot_messages', messages);

  const isNewSender = messages.length < 2 || messages[messages.length - 2].role !== 'user';
  const dateLabel   = formatDate(msg.timestamp);
  const prevLabel   = messages.length > 1 ? formatDate(messages[messages.length - 2].timestamp) : null;

  if (dateLabel !== prevLabel) {
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.textContent = dateLabel;
    messageList.appendChild(sep);
  }

  renderBubble(msg, isNewSender);
  scrollToBottom();
}

function addBotBubble(text, timestamp = new Date().toISOString(), save = true) {
  const msg = { id: genId(), role: 'bot', text, timestamp };
  if (save) {
    messages.push(msg);
    saveData('pabot_messages', messages);
  }

  const isNewSender = !save || messages.length < 2 || messages[messages.length - 2].role !== 'bot';
  renderBubble(msg, isNewSender);
  scrollToBottom();
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'msg-row bot new-sender typing-bubble';
  row.id = 'typing-indicator';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  row.appendChild(bubble);
  messageList.appendChild(row);
  scrollToBottom();
}

function hideTyping() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

function scrollToBottom() {
  const view = document.getElementById('chat-view');
  view.scrollTop = view.scrollHeight;
}

// ── Task Rendering — Infinite Scroll ──
//
// Instead of building 11,800 DOM nodes upfront (1998 → 2031), we render only
// ~180 days around today on open, then silently extend in either direction as
// the user scrolls. An IntersectionObserver watches invisible sentinel divs at
// the top and bottom of the list and triggers loading when they come into view.

const TASK_MIN_DATE = new Date('1998-11-19T00:00:00');  // birthdate — hard limit
const TASK_MAX_DATE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  d.setHours(0, 0, 0, 0);
  return d;
})();
const TASK_CHUNK = 180;  // days per load-more batch

let taskWindowStart  = null;   // earliest date currently in the DOM
let taskWindowEnd    = null;   // latest date currently in the DOM
let taskObserver     = null;   // IntersectionObserver instance
let tasksByDateCache = {};     // tasks indexed by YYYY-MM-DD key

// Rebuild the date→tasks index from the live tasks array
function buildTaskIndex() {
  tasksByDateCache = {};
  tasks.forEach(task => {
    const key = task.reminder_iso ? toDateKey(task.reminder_iso) : toDateKey(task.created_at);
    if (!tasksByDateCache[key]) tasksByDateCache[key] = [];
    tasksByDateCache[key].push(task);
  });
}

// Build a single day-group element (header + tasks or empty row)
function buildDayGroup(dateKey) {
  const today     = todayKey();
  const yesterday = toDateKey(new Date(Date.now() - 86400000).toISOString());
  const tomorrow  = toDateKey(new Date(Date.now() + 86400000).toISOString());

  const group = document.createElement('div');
  group.className = 'day-group';
  group.dataset.date = dateKey;

  const header = document.createElement('div');
  header.className = 'date-group-header' + (dateKey === today ? ' today' : '');

  if      (dateKey === today)     header.textContent = 'Today';
  else if (dateKey === yesterday) header.textContent = 'Yesterday';
  else if (dateKey === tomorrow)  header.textContent = 'Tomorrow';
  else {
    const d = new Date(dateKey + 'T12:00:00');
    header.textContent = d.toLocaleDateString('en-CA', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  group.appendChild(header);

  const dayTasks = tasksByDateCache[dateKey] || [];
  if (dayTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'day-empty';
    group.appendChild(empty);
  } else {
    dayTasks.forEach(task => group.appendChild(buildTaskItem(task)));
  }

  return group;
}

// Build a DocumentFragment of day-groups for a date range (inclusive)
function buildTaskChunk(fromDate, toDate) {
  const frag = document.createDocumentFragment();
  const cur  = new Date(fromDate); cur.setHours(0, 0, 0, 0);
  const end  = new Date(toDate);   end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    frag.appendChild(buildDayGroup(toDateKey(cur.toISOString())));
    cur.setDate(cur.getDate() + 1);
  }
  return frag;
}

// Wire up the IntersectionObserver on the two sentinel divs
function setupTaskObserver() {
  if (taskObserver) taskObserver.disconnect();

  const taskView       = document.getElementById('task-view');
  const topSentinel    = document.getElementById('task-sentinel-top');
  const bottomSentinel = document.getElementById('task-sentinel-bottom');

  taskObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const list = document.getElementById('task-list');

      if (entry.target.id === 'task-sentinel-top') {
        // User scrolled to the top — prepend an earlier chunk
        const newEnd   = new Date(taskWindowStart); newEnd.setDate(newEnd.getDate() - 1);
        const newStart = new Date(newEnd);           newStart.setDate(newStart.getDate() - TASK_CHUNK + 1);
        if (newStart < TASK_MIN_DATE) newStart.setTime(TASK_MIN_DATE.getTime());

        if (newEnd >= TASK_MIN_DATE) {
          // Insert the new days right after the sentinel (i.e. before the existing first day)
          topSentinel.after(buildTaskChunk(newStart, newEnd));
          taskWindowStart = new Date(newStart);
        }

        // Hide sentinel once we've reached the hard limit
        if (taskWindowStart <= TASK_MIN_DATE) {
          topSentinel.style.display = 'none';
          taskObserver.unobserve(topSentinel);
        }
      }

      if (entry.target.id === 'task-sentinel-bottom') {
        // User scrolled to the bottom — append a later chunk
        const newStart = new Date(taskWindowEnd); newStart.setDate(newStart.getDate() + 1);
        const newEnd   = new Date(newStart);       newEnd.setDate(newEnd.getDate() + TASK_CHUNK - 1);
        if (newEnd > TASK_MAX_DATE) newEnd.setTime(TASK_MAX_DATE.getTime());

        if (newStart <= TASK_MAX_DATE) {
          // Insert the new days right before the sentinel (i.e. after the existing last day)
          bottomSentinel.before(buildTaskChunk(newStart, newEnd));
          taskWindowEnd = new Date(newEnd);
        }

        // Hide sentinel once we've reached the hard limit
        if (taskWindowEnd >= TASK_MAX_DATE) {
          bottomSentinel.style.display = 'none';
          taskObserver.unobserve(bottomSentinel);
        }
      }
    });
  }, {
    root:       taskView,
    rootMargin: '300px'  // start loading 300px before the sentinel hits the edge
  });

  if (taskWindowStart > TASK_MIN_DATE) taskObserver.observe(topSentinel);
  if (taskWindowEnd   < TASK_MAX_DATE) taskObserver.observe(bottomSentinel);
}

// Main entry point — called when switching to task view
function renderTasks() {
  // Disconnect any previous observer before wiping the DOM
  if (taskObserver) { taskObserver.disconnect(); taskObserver = null; }

  buildTaskIndex();

  const list = document.getElementById('task-list');
  list.innerHTML = '';

  // Initial window: 90 days back → 90 days forward (180 days total, ~instant render)
  const now = new Date();
  taskWindowStart = new Date(now); taskWindowStart.setDate(taskWindowStart.getDate() - 90); taskWindowStart.setHours(0, 0, 0, 0);
  taskWindowEnd   = new Date(now); taskWindowEnd.setDate(taskWindowEnd.getDate() + 90);     taskWindowEnd.setHours(0, 0, 0, 0);
  if (taskWindowStart < TASK_MIN_DATE) taskWindowStart = new Date(TASK_MIN_DATE);
  if (taskWindowEnd   > TASK_MAX_DATE) taskWindowEnd   = new Date(TASK_MAX_DATE);

  // Sentinel: triggers loading more past days when scrolled into view
  const topSentinel = document.createElement('div');
  topSentinel.id = 'task-sentinel-top';
  topSentinel.style.height = '1px';
  list.appendChild(topSentinel);

  // The initial ~180 days
  list.appendChild(buildTaskChunk(taskWindowStart, taskWindowEnd));

  // Sentinel: triggers loading more future days when scrolled into view
  const bottomSentinel = document.createElement('div');
  bottomSentinel.id = 'task-sentinel-bottom';
  bottomSentinel.style.height = '1px';
  list.appendChild(bottomSentinel);

  // Scroll to today, then arm the observer (two rAF frames to let scroll settle first)
  const today = todayKey();
  requestAnimationFrame(() => {
    const todayEl = list.querySelector(`.day-group[data-date="${today}"]`);
    if (todayEl) todayEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    requestAnimationFrame(() => setupTaskObserver());
  });
}

function buildTaskItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item';
  item.dataset.id = task.id;

  const check = document.createElement('div');
  check.className = 'task-check' + (task.completed ? ' done' : '');
  check.addEventListener('click', () => toggleTask(task.id));

  const body = document.createElement('div');
  body.className = 'task-body';

  const text = document.createElement('div');
  text.className = 'task-text' + (task.completed ? ' done' : '');
  text.textContent = task.text;

  body.appendChild(text);

  if (task.reminder_iso) {
    const badge = document.createElement('div');
    badge.className = 'task-reminder-badge';
    badge.textContent = '⏰ ' + new Date(task.reminder_iso).toLocaleTimeString('en-CA', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
    body.appendChild(badge);
  }

  item.appendChild(check);
  item.appendChild(body);
  return item;
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveData('pabot_tasks', tasks);

  // Update just the affected row — no full re-render needed
  const item  = document.querySelector(`.task-item[data-id="${id}"]`);
  if (item) {
    item.querySelector('.task-check').classList.toggle('done', task.completed);
    item.querySelector('.task-text').classList.toggle('done', task.completed);
  }
}

// ── Journal Rendering ──

function renderJournals() {
  const list = document.getElementById('journal-list');
  list.innerHTML = '';

  if (journals.length === 0) {
    list.innerHTML = '<div class="empty-state">No journal entries yet.<br>Tell PABot how your day is going.</div>';
    return;
  }

  const groups = {};
  journals.forEach(entry => {
    const key = toDateKey(entry.created_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(entry);
  });

  const sortedKeys = Object.keys(groups).sort().reverse(); // newest first for journal
  const today = todayKey();

  sortedKeys.forEach(dateKey => {
    const header = document.createElement('div');
    header.className = 'date-group-header' + (dateKey === today ? ' today' : '');

    const d = new Date(dateKey + 'T12:00:00');
    header.textContent = dateKey === today
      ? 'Today'
      : d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

    list.appendChild(header);

    groups[dateKey].forEach(entry => {
      const item = document.createElement('div');
      item.className = 'journal-item';

      const time = document.createElement('div');
      time.className = 'journal-time';
      time.textContent = formatTime(entry.created_at);

      const text = document.createElement('div');
      text.className = 'journal-text';
      text.textContent = entry.text;

      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
    });
  });
}

// ── Chat Input & API ──

const chatInput   = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');

async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  chatInput.value = '';
  chatInput.disabled = true;
  chatSendBtn.disabled = true;

  addUserBubble(message);
  showTyping();

  try {
    const res  = await fetch(`${SERVER}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();

    hideTyping();

    if (data.error) {
      addBotBubble(`Something went wrong: ${data.error}`);
    } else {
      addBotBubble(data.reply || 'Done.');
      handleIntent(data);
    }

  } catch {
    hideTyping();
    addBotBubble('Could not reach the server. Make sure it\'s running with npm start.');
  }

  chatInput.disabled = false;
  chatSendBtn.disabled = false;
  chatInput.focus();
}

// ── Intent Handler ──
// When Claude returns an intent, take the appropriate action

function handleIntent(data) {
  if (data.intent === 'create_task' || data.intent === 'set_reminder') {
    const task = {
      id:           genId(),
      text:         data.task_text || data.reminder_label || 'Task',
      reminder_iso: data.reminder_iso || null,
      has_reminder: data.intent === 'set_reminder',
      completed:    false,
      created_at:   new Date().toISOString()
    };
    tasks.push(task);
    saveData('pabot_tasks', tasks);

    // Register reminder with the server so it can fire even when this tab is closed
    if (data.intent === 'set_reminder' && task.reminder_iso) {
      fetch(`${SERVER}/reminders`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: task.id, title: task.text, reminder_iso: task.reminder_iso })
      }).catch(err => console.warn('Could not register reminder on server:', err.message));
    }
  }

  if (data.intent === 'create_journal') {
    const entry = {
      id:         genId(),
      text:       data.journal_text || '',
      created_at: new Date().toISOString()
    };
    journals.push(entry);
    saveData('pabot_journals', journals);
  }
}

// ── Push Notifications ──
// Registers the service worker, asks for permission, and sends the browser's
// push subscription to the server so it can deliver notifications later.

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications not supported in this browser.');
    return;
  }

  try {
    // Register the service worker — this is the background script that receives pushes
    const reg = await navigator.serviceWorker.register('/sw.js');

    // Ask for notification permission (browser shows the allow/block dialog)
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission denied.');
      return;
    }

    // Get our server's public VAPID key — needed to create the push subscription
    const keyRes = await fetch(`${SERVER}/push/vapid-public-key`);
    if (!keyRes.ok) {
      console.warn('VAPID key not available — push notifications not set up on server yet.');
      return;
    }
    const { publicKey } = await keyRes.json();

    // Create a push subscription tied to this browser + our server's VAPID key
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,                    // required: must show a notification for every push
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // Send the subscription to our server so it knows where to push
    await fetch(`${SERVER}/push/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription)
    });

    console.log('Push notifications active.');

  } catch (err) {
    console.error('Push setup failed:', err.message);
  }
}

// The browser's PushManager requires the VAPID public key as a Uint8Array.
// VAPID keys are base64url-encoded strings, so we convert here.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Event Listeners ──

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

// ── Dev: Seed test tasks ──
// Open browser console and run: seedTestTasks()
window.seedTestTasks = function() {
  const offsets = [-7, -5, -3, -2, -1, 0, 0, 1, 2, 4, 7, 14];
  const samples = [
    { text: 'Call the clinic about rescheduling',   hasReminder: false },
    { text: 'Pick up compression socks',            hasReminder: true,  time: '09:00' },
    { text: 'Renew massage table cover',            hasReminder: false },
    { text: 'Email invoice to Sarah',               hasReminder: true,  time: '10:00' },
    { text: 'Buy milk',                             hasReminder: true,  time: '13:30' },
    { text: 'Book gym session',                     hasReminder: false },
    { text: 'Order more massage oil',               hasReminder: true,  time: '11:00' },
    { text: 'Confirm Thursday appointments',        hasReminder: true,  time: '08:30' },
    { text: 'Pay hydro bill',                       hasReminder: true,  time: '17:00' },
    { text: 'Stretch and foam roll',                hasReminder: true,  time: '20:00' },
    { text: 'Review monthly expenses',              hasReminder: false },
    { text: 'Call mom',                             hasReminder: true,  time: '18:00' },
  ];

  offsets.forEach((offset, i) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    const sample = samples[i % samples.length];

    let reminder_iso = null;
    if (sample.hasReminder) {
      const [h, m] = sample.time.split(':');
      const rd = new Date(d);
      rd.setHours(parseInt(h), parseInt(m), 0, 0);
      reminder_iso = rd.toISOString();
    }

    tasks.push({
      id:           genId(),
      text:         sample.text,
      reminder_iso,
      has_reminder: !!reminder_iso,
      completed:    offset < -2,  // tasks older than 2 days are pre-completed
      created_at:   d.toISOString()
    });
  });

  saveData('pabot_tasks', tasks);
  renderTasks();
  console.log('Test tasks seeded.');
};

// ── Momentum Scrolling ──
// Adds mouse-drag inertia to a scrollable element.
// On mobile, the browser handles momentum natively via touch events — this
// only activates for mouse input so the two don't conflict.

function enableMomentumScroll(el) {
  let dragging = false;
  let prevY    = 0;
  let prevTime = 0;
  let vel      = 0;    // pixels per millisecond (positive = scrolling down)
  let raf      = null;

  el.addEventListener('mousedown', e => {
    dragging = true;
    prevY    = e.clientY;
    prevTime = performance.now();
    vel      = 0;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    el.style.userSelect = 'none';   // prevent text selection while dragging
    el.style.cursor     = 'grabbing';
    e.preventDefault();
  });

  // Listen on window so the drag works even if the mouse leaves the element
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const now = performance.now();
    const dt  = now - prevTime;
    const dy  = prevY - e.clientY;   // positive = moved up = content scrolls down
    if (dt > 0) vel = dy / dt;
    el.scrollTop += dy;
    prevY    = e.clientY;
    prevTime = now;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging            = false;
    el.style.userSelect = '';
    el.style.cursor     = '';
    if (Math.abs(vel) > 0.1) coast(performance.now());
  });

  // Apply velocity with exponential friction until it decays to nothing
  function coast(lastTime) {
    raf = requestAnimationFrame(now => {
      const dt = now - lastTime;
      el.scrollTop      += vel * dt;
      vel               *= Math.pow(0.94, dt / 16);  // friction normalised to 60 fps
      if (Math.abs(vel) > 0.05) coast(now);
      else raf = null;
    });
  }
}

// Apply to task and journal views — the long-scroll ones
enableMomentumScroll(document.getElementById('task-view'));
enableMomentumScroll(document.getElementById('journal-view'));

// ── Init ──
renderMessages();
initPush();
