require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { checkForNewShips } = require('./poller');
const { getShipsInBay, getUpcomingShips, getAlerts } = require('./store');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/ships/current', (req, res) => {
  const ships = getShipsInBay();
  res.json({ ships, updated_at: new Date().toISOString() });
});

app.get('/api/ships/upcoming', (req, res) => {
  const ships = getUpcomingShips();
  res.json({ ships });
});

app.get('/api/alerts', (req, res) => {
  const alerts = getAlerts();
  res.json({ alerts });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// TEST ENDPOINT — sends a fake notification to your phone
app.get('/api/test', async (req, res) => {
  const { sendNotification, sendDepartureNotification } = require('./notifications');
  
  const fakeShip = {
    name: 'Ruby Princess',
    company: 'Princess Cruises',
    terminal: 'Pier 27',
    from: 'Los Angeles, CA',
    to: 'Seattle, WA',
    eta_date: '4/29/2026',
    eta_time: '8:00 AM',
    etd_date: '4/29/2026',
    etd_time: '4:00 PM'
  };

  await sendNotification(fakeShip);
  await sendDepartureNotification(fakeShip);
  
  res.json({ status: 'Test notifications sent! Check your phone 📱' });
});

cron.schedule('*/5 * * * *', async () => {
  console.log(`[${new Date().toLocaleTimeString()}] Polling SF Bay for cruise ships (every 5 min)...`);
  try {
    await checkForNewShips();
  } catch (err) {
    console.error('Polling error:', err.message);
  }
});

checkForNewShips().catch(console.error);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🛳  Cruise Monsta running on port ${PORT}`);
});
