require('dotenv').config();
const axios = require('axios');
const { saveShipsInBay, getKnownShipIds, addAlert } = require('./store');
const { sendNotification, sendDepartureNotification } = require('./notifications');

const PORT_URL = 'https://www.cruisemapper.com/ports/san-francisco-port-2';

function getTodayDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric', year: 'numeric'
  });
}

function getTodayDay() {
  return parseInt(new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', day: 'numeric'
  }));
}

function getTodayMonth() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'long'
  });
}

// Convert "08:00" to "8:00 AM"
function formatTime(timeStr) {
  if (!timeStr || timeStr.trim() === '' || timeStr.trim() === '-') return '—';
  const match = timeStr.trim().match(/(\d{1,2}):(\d{2})/);
  if (!match) return '—';
  let hours = parseInt(match[1]);
  const mins = match[2];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return `${h}:${mins} ${ampm}`;
}

// Convert "8:00 AM" to a Date object today in PST
function timeStringToDate(timeStr) {
  if (!timeStr || timeStr === '—') return null;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const mins = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  const now = new Date();
  const pst = new Date(now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }));
  pst.setHours(hours, mins, 0, 0);
  return pst;
}

function isDepartingInFiveMinutes(timeStr) {
  const departTime = timeStringToDate(timeStr);
  if (!departTime) return false;
  const now = new Date();
  const diffMins = (departTime - now) / 1000 / 60;
  return diffMins >= 4 && diffMins <= 6;
}

async function fetchTodaysShips() {
  const response = await axios.get(PORT_URL, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CruiseMonsta/1.0)' }
  });

  const html = response.data;
  const today = getTodayDay();
  const todayMonth = getTodayMonth(); // e.g. "April"
  const ships = [];

  // Match table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];

    // Strip HTML tags from cells
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }

    if (cells.length < 4) continue;

    // cells[0] = "29 April, 2026 Wednesday"
    // cells[1] = "Cruise Line ShipName"
    // cells[2] = arrival time or empty
    // cells[3] = departure time or "next day date, time"

    const dayCell = cells[0];
    if (!dayCell.includes(todayMonth)) continue;
    const dayNum = parseInt(dayCell);
    if (isNaN(dayNum) || dayNum !== today) continue;

    // Extract ship name — remove cruise line prefix
    let shipName = cells[1]
      .replace(/Princess Cruises Cruises cruise line/gi, '')
      .replace(/Holland America Cruises cruise line/gi, '')
      .replace(/Norwegian Cruise Line Cruises cruise line/gi, '')
      .replace(/Carnival Cruise Line Cruises cruise line/gi, '')
      .replace(/Celebrity Cruises Cruises cruise line/gi, '')
      .replace(/Royal Caribbean Cruises cruise line/gi, '')
      .replace(/Disney Cruise Line Cruises cruise line/gi, '')
      .replace(/Viking Ocean Cruises cruise line/gi, '')
      .replace(/Cruises cruise line/gi, '')
      .trim();

    if (!shipName || shipName.length < 3) continue;

    const arrivalRaw = cells[2] || '';
    const departureRaw = cells[3] || '';

    // Handle next-day departures like "30 Apr, 18:00"
    let departureTime = '—';
    const nextDayMatch = departureRaw.match(/\d+\s+\w+,\s+(\d{1,2}:\d{2})/);
    if (nextDayMatch) {
      departureTime = formatTime(nextDayMatch[1]);
    } else {
      departureTime = formatTime(departureRaw);
    }

    ships.push({
      name: shipName,
      company: guessCompany(shipName),
      eta_time: formatTime(arrivalRaw),
      etd_time: departureTime,
      eta_date: formatTime(arrivalRaw) !== '—' ? getTodayDate() : '—',
      etd_date: departureTime !== '—' ? getTodayDate() : '—'
    });
  }

  return ships;
}

async function checkForNewShips() {
  let todaysShips = [];

  try {
    todaysShips = await fetchTodaysShips();
    console.log(`CruiseMapper: ${todaysShips.length} ship(s) today in SF`);
  } catch (err) {
    console.error('CruiseMapper fetch error:', err.message);
    return [];
  }

  if (todaysShips.length === 0) {
    console.log('No cruise ships in SF today.');
    return [];
  }

  const knownIds = getKnownShipIds();

  const ships = todaysShips.map(raw => {
    const id = raw.name.toLowerCase().replace(/\s+/g, '-');
    return {
      id,
      name: raw.name,
      company: raw.company,
      status: 'Scheduled',
      from: '—',
      to: '—',
      terminal: 'Pier 27',
      arrived: raw.eta_time,
      eta_date: raw.eta_date,
      eta_time: raw.eta_time,
      etd_date: raw.etd_date,
      etd_time: raw.etd_time,
      is_new: !knownIds.has(id)
    };
  });

  // Arrival notifications
  for (const ship of ships) {
    if (ship.is_new) {
      console.log(`🆕 New ship: ${ship.name}`);
      await sendNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} · Docks: ${ship.eta_date} at ${ship.eta_time} · Departs: ${ship.etd_date} at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
    }
  }

  // Departure notifications — 5 minutes before
  for (const ship of ships) {
    const depId = `${ship.id}-departing`;
    if (isDepartingInFiveMinutes(ship.etd_time) && !knownIds.has(depId)) {
      console.log(`🚢 ${ship.name} departing in 5 minutes!`);
      await sendDepartureNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} is leaving the bay in 5 minutes! Departing at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
      // Save departure as notified
      const s = ships.find(x => x.id === ship.id);
      if (s) s.id = depId;
    }
  }

  saveShipsInBay(ships);
  console.log(`${ships.length} ship(s). ${ships.filter(s => s.is_new).length} new.`);
  return ships;
}

function guessCompany(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CARNIVAL') || n.includes('LUMINOSA')) return 'Carnival Cruise Line';
  if (n.includes('PRINCESS')) return 'Princess Cruises';
  if (n.includes('CELEBRITY')) return 'Celebrity Cruises';
  if (n.includes('NORWEGIAN') || n.includes('ENCORE') ||
      n.includes('BLISS') || n.includes('JADE')) return 'Norwegian Cruise Line';
  if (n.includes('ROYAL')) return 'Royal Caribbean';
  if (n.includes('HOLLAND') || n.includes('KONINGSDAM') ||
      n.includes('ZAANDAM') || n.includes('NIEUW') ||
      n.includes('OOSTERDAM') || n.includes('WESTERDAM') ||
      n.includes('NOORDAM') || n.includes('EURODAM')) return 'Holland America Line';
  if (n.includes('DISNEY')) return 'Disney Cruise Line';
  if (n.includes('VIKING')) return 'Viking Ocean Cruises';
  return 'Cruise Line';
}

module.exports = { checkForNewShips };
