require('dotenv').config();
const axios = require('axios');

const GREETINGS = [
  "Sup, cool beans?",
  "Hidy-ho, boyfriend.",
  "Oh, there's my favorite person.",
  "The legend has entered the chat aka ya gf.",
  "Yo yo yo.",
  "Wassup, legend?",
  "Hey there, bootiful.",
  "Hello sexy."
];

function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

async function sendNotification(ship) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;

  const greeting = pickGreeting();
  const dock = ship.eta_date !== '—' ? `Docks: ${ship.eta_date} at ${ship.eta_time}` : '';
  const depart = ship.etd_date !== '—' ? `Departs: ${ship.etd_date} at ${ship.etd_time}` : '';
  const route = [dock, depart].filter(Boolean).join(' · ');
  const to = ship.to !== '—' ? ` → ${ship.to}` : '';

  const message = `${greeting}\n${ship.name} just entered the bay.\nFrom: ${ship.from}${route ? '\n' + route + to : ''}`;

  console.log('\n📱 Notification preview:\n' + message + '\n');

  if (!token || !user) {
    console.warn('⚠️  Pushover keys not set — skipping notification.');
    return;
  }

  try {
    await axios.post('https://api.pushover.net/1/messages.json', {
      token,
      user,
      title: '🛳 Cruise Monsta',
      message,
      sound: 'bugle',
      priority: 0
    });
    console.log(`✅ Notification sent for ${ship.name}`);
  } catch (err) {
    console.error('Pushover error:', err.message);
  }
}

module.exports = { sendNotification };
