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

cron.schedule('*/15 * * * *', async () => {
  console.log(`[${new Date().toLocaleTimeString()}] Polling SF Bay for cruise ships...`);
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
