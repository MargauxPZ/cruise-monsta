require('dotenv').config();
const axios = require('axios');

const ARRIVAL_GREETINGS = [
  "Sup, cool beans?",
  "Hidy-ho, boyfriend.",
  "Oh, there's my favorite bunda.",
  "The legend has entered the chat aka ya gf.",
  "Yo yo yo.",
  "Wassup, legend?",
  "Hey there, bootiful.",
  "Hello sexy."
];

const DEPARTURE_GREETINGS = [
  "Babe, heads up!",
  "Yo, catch it while you can!",
  "Last call, legend!",
  "Quick, run to the window!",
  "Don't miss it, bootiful!",
  "She's leaving! Go look!",
  "5 mins, go go go!",
  "Byeee ship, wave wave wave!"
];

function pickGreeting(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function sendPushover(title, message) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;

  console.log('\n📱 Notification:\n' + message + '\n');

  if (!token || !user) {
    console.warn('Pushover keys not set — skipping notification.');
    return;
  }

  try {
    await axios.post('https://api.pushover.net/1/messages.json', {
      token,
      user,
      title,
      message,
      sound: 'bugle',
      priority: 0
    });
    console.log('✅ Notification sent!');
  } catch (err) {
    console.error('Pushover error:', err.message);
  }
}

async function sendNotification(ship) {
  const greeting = pickGreeting(ARRIVAL_GREETINGS);

  const lines = [greeting];
  lines.push(`${ship.name} just entered the bay!`);
  lines.push(`🚢 ${ship.company}`);

  if (ship.from && ship.from !== '—') {
    lines.push(`📍 Coming from: ${ship.from}`);
  }
  if (ship.eta_time && ship.eta_time !== '—') {
    lines.push(`⚓ Docks: ${ship.eta_date} at ${ship.eta_time}`);
  }
  if (ship.etd_time && ship.etd_time !== '—') {
    const to = ship.to && ship.to !== '—' ? ` → ${ship.to}` : '';
    lines.push(`🕐 Departs: ${ship.etd_date} at ${ship.etd_time}${to}`);
  }

  const message = lines.join('\n');
  await sendPushover('🛳 Cruise Monsta — Ship Arriving!', message);
}

async function sendDepartureNotification(ship) {
  const greeting = pickGreeting(DEPARTURE_GREETINGS);

  const lines = [greeting];
  lines.push(`${ship.name} is leaving the bay in 5 minutes!`);
  lines.push(`🚢 ${ship.company}`);

  if (ship.etd_time && ship.etd_time !== '—') {
    lines.push(`🕐 Departing at: ${ship.etd_time}`);
  }
  if (ship.to && ship.to !== '—') {
    lines.push(`📍 Heading to: ${ship.to}`);
  }
  if (ship.eta_time && ship.eta_time !== '—') {
    lines.push(`⚓ Arrived this morning at: ${ship.eta_time}`);
  }

  const message = lines.join('\n');
  await sendPushover('🚢 Cruise Monsta — Ship Departing!', message);
}

module.exports = { sendNotification, sendDepartureNotification };
