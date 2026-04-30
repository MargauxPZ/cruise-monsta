require('dotenv').config();
const axios = require('axios');

const ARRIVAL_GREETINGS = [
  "Sup, cool beans?",
  "Hidy-ho, boyfriend.",
  "Oh, there's my favorite person.",
  "The legend has entered the chat aka ya gf.",
  "Yo yo yo.",
  "Wassup, legend?",
  "Hey there, bootiful.",
  "Hello sexy."
];

const DEPARTURE_GREETINGS = [
  "Amooooooour, heads up!",
  "Yo, catch it while you can!",
  "Last call, legend!",
  "Quick, run to the window!",
  "Don't miss it, Jonas Ananas!",
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
  const dock = ship.eta_time !== '—' ? `Docks: ${ship.eta_date} at ${ship.eta_time}` : '';
  const depart = ship.etd_time !== '—' ? `Departs: ${ship.etd_date} at ${ship.etd_time}` : '';
  const route = [dock, depart].filter(Boolean).join(' · ');
  const message = `${greeting}\n${ship.name} just entered the bay!${route ? '\n' + route : ''}`;
  await sendPushover('🛳 Cruise Monsta — Arrival!', message);
}

async function sendDepartureNotification(ship) {
  const greeting = pickGreeting(DEPARTURE_GREETINGS);
  const message = `${greeting}\n${ship.name} is leaving the bay in 5 minutes!\nDeparting at ${ship.etd_time} from Pier 27.`;
  await sendPushover('🚢 Cruise Monsta — Departing!', message);
}

module.exports = { sendNotification, sendDepartureNotification };
