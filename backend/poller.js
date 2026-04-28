require('dotenv').config();
const axios = require('axios');
const { saveShipsInBay, getKnownShipIds, addAlert } = require('./store');
const { sendNotification } = require('./notifications');

// Golden Gate entrance corridor
// Covers full strait from China Beach / Lands End to Marin Headlands
const TRIGGER_ZONE = {
  minlat: 37.77,
  maxlat: 37.86,
  minlon: -122.56,
  maxlon: -122.44
};

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

async function checkForNewShips() {
  const apiKey = process.env.MARINETRAFFIC_API_KEY;

  if (!apiKey) {
    console.warn('No MARINETRAFFIC_API_KEY — skipping poll, no mock notifications.');
    return [];
  }

  let rawShips = [];

  try {
    const response = await axios.get(
      `https://services.marinetraffic.com/api/getvessel/v:8/${apiKey}/protocol:jsono`,
      {
        params: {
          minlat: TRIGGER_ZONE.minlat,
          maxlat: TRIGGER_ZONE.maxlat,
          minlon: TRIGGER_ZONE.minlon,
          maxlon: TRIGGER_ZONE.maxlon,
          vessel_type: '60,61,62,63,64,65,66,67,68,69',
          msgtype: 'extended'
        },
        timeout: 10000
      }
    );
    rawShips = response.data || [];
    console.log(`MarineTraffic: ${rawShips.length} cruise ship(s) at Golden Gate`);
  } catch (err) {
    console.error('MarineTraffic error:', err.message);
    return [];
  }

  const knownIds = getKnownShipIds();
  const ships = rawShips.map(raw => {
    const id = String(raw.MMSI || raw.IMO || '');
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
      lat: raw.LAT,
      lon: raw.LON,
      is_new: !knownIds.has(id)
    };
  });

  for (const ship of ships) {
    if (ship.is_new) {
      console.log(`🆕 New ship at Golden Gate: ${ship.name}`);
      await sendNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} · From: ${ship.from} · Docks: ${ship.eta_date} at ${ship.eta_time} · Departs: ${ship.etd_date} at ${ship.etd_time} → ${ship.to}`,
        sent_at: new Date().toISOString()
      });
    }
  }

  saveShipsInBay(ships);
  console.log(`${ships.length} ship(s) in zone. ${ships.filter(s => s.is_new).length} new.`);
  return ships;
}

module.exports = { checkForNewShips };
