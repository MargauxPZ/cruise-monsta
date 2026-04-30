require('dotenv').config();
const axios = require('axios');
const { saveShipsInBay, getKnownShipIds, addAlert } = require('./store');
const { sendDepartureNotification, sendNotification } = require('./notifications');

function getScheduleUrl() {
  const now = new Date();
  const months = ['jan','feb','mar','apr','may','jun',
                  'jul','aug','sep','oct','nov','dec'];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  return `https://www.cruisetimetables.com/sanfranciscocaliforniaschedule-${month}${year}.html`;
}

function parseTime(timeStr) {
  if (!timeStr || timeStr.trim() === '') return '—';
  const clean = timeStr.trim().replace(':', '');
  if (clean.length < 3) return '—';
  const padded = clean.padStart(4, '0');
  const hours = parseInt(padded.substring(0, 2));
  const mins = padded.substring(2, 4);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return `${h}:${mins} ${ampm}`;
}

function getTodayDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric', year: 'numeric'
  });
}

function getTodayDay() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    day: 'numeric'
  });
}

// Convert "6:00 PM" to today's Date object in PST
function timeStringToDate(timeStr) {
  if (!timeStr || timeStr === '—') return null;
  const now = new Date();
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const mins = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  // Build date in PST
  const pst = new Date(now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }));
  pst.setHours(hours, mins, 0, 0);
  return pst;
}

// Check if departure is within 5 minutes from now
function isDepartingInFiveMinutes(timeStr) {
  const departTime = timeStringToDate(timeStr);
  if (!departTime) return false;
  const now = new Date();
  const diffMs = departTime - now;
  const diffMins = diffMs / 1000 / 60;
  return diffMins >= 4 && diffMins <= 6; // between 4-6 min window
}

async function fetchTodaysShips() {
  const url = getScheduleUrl();
  console.log(`Fetching schedule from: ${url}`);

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CruiseMonsta/1.0)' }
  });

  const html = response.data;
  const today = parseInt(getTodayDay());
  const ships = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    const cells = [];
    let cellMatch;
    const cellRegexLocal = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRegexLocal.exec(rowContent)) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .trim();
      cells.push(text);
    }

    if (cells.length < 2) continue;
    const dayCell = parseInt(cells[0]);
    if (isNaN(dayCell) || dayCell !== today) continue;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const fullPattern = cell.match(/a\s+(\d{4})\s+d\s+(\d{4})/i);
      const departOnly = cell.match(/^d\s+(\d{4})$/i);

      if (fullPattern || departOnly) {
        const shipName = cells[i - 1] || cells[i];
        if (!shipName || shipName.length < 3) continue;

        let arrivalTime = '—';
        let departureTime = '—';

        if (fullPattern) {
          arrivalTime = parseTime(fullPattern[1]);
          departureTime = parseTime(fullPattern[2]);
        } else if (departOnly) {
          departureTime = parseTime(departOnly[1]);
        }

        ships.push({
          name: shipName,
          eta_time: arrivalTime,
          etd_time: departureTime,
          eta_date: arrivalTime !== '—' ? getTodayDate() : '—',
          etd_date: departureTime !== '—' ? getTodayDate() : '—'
        });
      }
    }
  }

  return ships;
}

async function checkForNewShips() {
  let todaysShips = [];

  try {
    todaysShips = await fetchTodaysShips();
    console.log(`CruiseTimetables: ${todaysShips.length} ship(s) scheduled today`);
  } catch (err) {
    console.error('CruiseTimetables fetch error:', err.message);
    return [];
  }

  if (todaysShips.length === 0) {
    console.log('No cruise ships scheduled in SF today.');
    return [];
  }

  const knownIds = getKnownShipIds();
  const ships = todaysShips.map(raw => {
    const id = raw.name.toLowerCase().replace(/\s+/g, '-');
    return {
      id,
      name: raw.name,
      company: guessCompany(raw.name),
      status: 'Scheduled',
      from: '—',
      to: '—',
      terminal: 'Pier 27',
      arrived: raw.eta_time,
      eta_date: raw.eta_date,
      eta_time: raw.eta_time,
      etd_date: raw.etd_date,
      etd_time: raw.etd_time,
      is_new: !knownIds.has(id),
      departure_notified: false
    };
  });

  // Check arrivals — notify for new ships
  for (const ship of ships) {
    if (ship.is_new) {
      console.log(`🆕 New ship today: ${ship.name}`);
      await sendNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} · Docks: ${ship.eta_date} at ${ship.eta_time} · Departs: ${ship.etd_date} at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
    }
  }

  // Check departures — notify 5 minutes before departure
  for (const ship of ships) {
    const depId = `${ship.id}-departing`;
    if (isDepartingInFiveMinutes(ship.etd_time) && !knownIds.has(depId)) {
      console.log(`🚢 ${ship.name} departing in 5 minutes!`);
      await sendDepartureNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} is leaving the bay in 5 minutes! · Departed: ${ship.etd_date} at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
      // Mark departure as notified so we don't send twice
      ships.find(s => s.id === ship.id).id = depId;
    }
  }

  saveShipsInBay(ships);
  console.log(`${ships.length} ship(s) today. ${ships.filter(s => s.is_new).length} new.`);
  return ships;
}

function guessCompany(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CARNIVAL')) return 'Carnival Cruise Line';
  if (n.includes('PRINCESS')) return 'Princess Cruises';
  if (n.includes('CELEBRITY')) return 'Celebrity Cruises';
  if (n.includes('NORWEGIAN')) return 'Norwegian Cruise Line';
  if (n.includes('ROYAL')) return 'Royal Caribbean';
  if (n.includes('HOLLAND') || n.includes('KONINGSDAM') ||
      n.includes('ZAANDAM') || n.includes('EURODAM') ||
      n.includes('WESTERDAM') || n.includes('OOSTERDAM') ||
      n.includes('NOORDAM') || n.includes('VOLENDAM') ||
      n.includes('ZUIDERDAM') || n.includes('NIEUW')) return 'Holland America Line';
  if (n.includes('DISNEY')) return 'Disney Cruise Line';
  if (n.includes('VIKING')) return 'Viking Ocean Cruises';
  if (n.includes('ENCORE') || n.includes('BLISS') ||
      n.includes('BREAKAWAY') || n.includes('GETAWAY')) return 'Norwegian Cruise Line';
  return 'Cruise Line';
}

module.exports = { checkForNewShips };
