require('dotenv').config();
const axios = require('axios');
const { saveShipsInBay, getKnownShipIds, addAlert } = require('./store');
const { sendNotification } = require('./notifications');

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric', year: 'numeric'
  });
}

function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function guessCompany(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CARNIVAL')) return 'Carnival Cruise Line';
  if (n.includes('PRINCESS')) return 'Princess Cruises';
  if (n.includes('CELEBRITY')) return 'Celebrity Cruises';
  if (n.includes('NORWEGIAN')) return 'Norwegian Cruise Line';
  if (n.includes('ROYAL')) return 'Royal Caribbean';
  if (n.includes('HOLLAND')) return 'Holland America Line';
  if (n.includes('DISNEY')) return 'Disney Cruise Line';
  if (n.includes('VIKING')) return 'Viking Ocean Cruises';
  return 'Cruise Line';
}

function getMockShips() {
  const now = new Date();
  return [
    {
      MMSI: '123456789',
      SHIPNAME: 'Ruby Princess',
      STATUS: 'Docked',
      LAST_PORT: 'Los Angeles, CA',
      DESTINATION: 'Seattle, WA',
      TIMESTAMP: new Date(now - 2 * 3600000).toISOString(),
      ETA: new Date(now - 1 * 3600000).toISOString(),
      ETD: new Date(now + 8 * 3600000).toISOString()
    },
    {
      MMSI: '987654321',
      SHIPNAME: 'Carnival Miracle',
      STATUS: 'Docked',
      LAST_PORT: 'Ensenada, Mexico',
      DESTINATION: 'SF Home Port',
      TIMESTAMP: new Date(now - 18 * 3600000).toISOString(),
      ETA: new Date(now - 16 * 3600000).toISOString(),
      ETD: new Date(now + 2 * 3600000).toISOString()
    }
  ];
}

async function checkForNewShips() {
  const apiKey = process.env.MARINETRAFFIC_API_KEY;
  let rawShips = [];

  if (!apiKey) {
    console.warn('No API key — using mock data');
    rawShips = getMockShips();
  } else {
    try {
      const response = await axios.get(
        `https://services.marinetraffic.com/api/getvessel/v:8/${apiKey}/protocol:jsono`,
        {
          params: {
            minlat: 37.45, maxlat: 37.95,
            minlon: -122.55, maxlon: -122.15,
            vessel_type: '60,61,62,63,64,65,66,67,68,69',
            msgtype: 'extended'
          },
          timeout: 10000
        }
      );
      rawShips = response.data || [];
    } catch (err) {
      console.error('MarineTraffic error:', err.message);
      rawShips = getMockShips();
    }
  }

  const knownIds = getKnownShipIds();
  const ships = rawShips.map(raw => {
    const id = String(raw.MMSI || raw.IMO || Math.random());
    return {
      id,
      name: raw.SHIPNAME || 'Unknown Ship',
      company: guessCompany(raw.SHIPNAME),
      status: raw.STATUS || 'In Bay',
      from: raw.LAST_PORT || '—',
      to: raw.DESTINATION || '—',
      terminal: 'Pier 27',
      arrived: formatTime(raw.TIMESTAMP),
      eta_date: formatDate(raw.ETA),
      eta_time: formatTime(raw.ETA),
      etd_date: formatDate(raw.ETD),
      etd_time: formatTime(raw.ETD),
      is_new: !knownIds.has(id)
    };
  });

  for (const ship of ships) {
    if (ship.is_new) {
      console.log(`🆕 New ship: ${ship.name}`);
      await sendNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} · From: ${ship.from} · Docks: ${ship.eta_date} ${ship.eta_time} · Departs: ${ship.etd_date} ${ship.etd_time} → ${ship.to}`,
        sent_at: new Date().toISOString()
      });
    }
  }

  saveShipsInBay(ships);
  console.log(`${ships.length} ship(s) in bay. ${ships.filter(s => s.is_new).length} new.`);
  return ships;
}

module.exports = { checkForNewShips };
