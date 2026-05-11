require('dotenv').config();
const axios = require('axios');
const { saveShipsInBay, getKnownShipIds, addAlert } = require('./store');
const { sendNotification, sendDepartureNotification } = require('./notifications');

const ARRIVALS_URL = 'https://cruisedig.com/ports/san-francisco-california/arrivals';
const DEPARTURES_URL = 'https://cruisedig.com/ports/san-francisco-california/departures';

function getNowPST() {
  const now = new Date();
  const pstString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  return new Date(pstString);
}

function getTodayStringPST() {
  const pst = getNowPST();
  const dd = String(pst.getDate()).padStart(2, '0');
  const mm = String(pst.getMonth() + 1).padStart(2, '0');
  const yyyy = pst.getFullYear();
  return `${dd} ${getMonthName(pst.getMonth())} ${yyyy}`;
}

function getMonthName(index) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][index];
}

function getTodayDate() {
  const pst = getNowPST();
  return `${pst.getMonth()+1}/${pst.getDate()}/${pst.getFullYear()}`;
}

// Parse "03 May 2026 - 08:30" → "8:30 AM"
function parseDateTime(str) {
  if (!str) return { date: '—', time: '—', dateObj: null };
  const match = str.match(/(\d+)\s+(\w+)\s+(\d+)\s*-\s*(\d+):(\d+)/);
  if (!match) return { date: '—', time: '—', dateObj: null };

  const day = parseInt(match[1]);
  const month = match[2];
  const year = parseInt(match[3]);
  let hours = parseInt(match[4]);
  const mins = match[5];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;

  const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const monthIndex = months[month.toLowerCase()] ?? 0;

  const dateObj = new Date(year, monthIndex, day, hours, parseInt(mins), 0, 0);

  return {
    date: `${monthIndex+1}/${day}/${year}`,
    time: `${h}:${mins} ${ampm}`,
    dateObj
  };
}

// Check if a Date object is 4-6 minutes from now in PST
function isDepartingInFiveMinutes(dateObj) {
  if (!dateObj) return false;
  const now = getNowPST();
  const diffMins = (dateObj - now) / 1000 / 60;
  console.log(`  Departure check: ${diffMins.toFixed(1)} minutes away`);
  return diffMins >= 4 && diffMins <= 6;
}

// Scrape ship list from a CruiseDig page
async function scrapeShips(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });

  const html = response.data;
  const ships = [];

  // CruiseDig format:
  // <a href="/ships/ruby-princess">Ruby Princess</a>
  // <a href="/...">Princess Cruises</a>
  // 3.672 passengers
  // 03 May 2026 - 15:00

  const shipBlockRegex = /href="\/ships\/[^"]+">([^<]+)<\/a>[\s\S]*?href="\/[^"]*cruise[^"]*">([^<]+)<\/a>[\s\S]*?(\d[\d,.]+ passengers)[\s\S]*?(\d{2}\s+\w+\s+\d{4}\s*-\s*\d{2}:\d{2})/gi;

  let match;
  while ((match = shipBlockRegex.exec(html)) !== null) {
    const shipName = match[1].trim();
    const cruiseLine = match[2].trim();
    const dateTimeStr = match[4].trim();
    const parsed = parseDateTime(dateTimeStr);

    ships.push({
      name: shipName,
      company: cruiseLine,
      dateTimeStr,
      date: parsed.date,
      time: parsed.time,
      dateObj: parsed.dateObj
    });
  }

  return ships;
}

async function fetchTodaysSchedule() {
  const pst = getNowPST();
  const todayDay = pst.getDate();
  const todayMonth = pst.getMonth(); // 0-indexed
  const todayYear = pst.getFullYear();

  console.log(`Fetching CruiseDig schedule for ${getTodayDate()}...`);

  const [arrivals, departures] = await Promise.all([
    scrapeShips(ARRIVALS_URL),
    scrapeShips(DEPARTURES_URL)
  ]);

  console.log(`Raw arrivals: ${arrivals.length}, departures: ${departures.length}`);

  // Filter to today only
  const todayArrivals = arrivals.filter(s => {
    if (!s.dateObj) return false;
    return s.dateObj.getDate() === todayDay &&
           s.dateObj.getMonth() === todayMonth &&
           s.dateObj.getFullYear() === todayYear;
  });

  const todayDepartures = departures.filter(s => {
    if (!s.dateObj) return false;
    return s.dateObj.getDate() === todayDay &&
           s.dateObj.getMonth() === todayMonth &&
           s.dateObj.getFullYear() === todayYear;
  });

  console.log(`Today arrivals: ${todayArrivals.length}, departures: ${todayDepartures.length}`);

  // Merge arrivals and departures by ship name
  const shipMap = {};

  for (const a of todayArrivals) {
    const key = a.name.toLowerCase();
    if (!shipMap[key]) shipMap[key] = { name: a.name, company: a.company };
    shipMap[key].eta_time = a.time;
    shipMap[key].eta_date = a.date;
    shipMap[key].eta_dateObj = a.dateObj;
  }

  for (const d of todayDepartures) {
    const key = d.name.toLowerCase();
    if (!shipMap[key]) shipMap[key] = { name: d.name, company: d.company };
    shipMap[key].etd_time = d.time;
    shipMap[key].etd_date = d.date;
    shipMap[key].etd_dateObj = d.dateObj;
  }

  return Object.values(shipMap);
}

async function checkForNewShips() {
  let todaysShips = [];

  try {
    todaysShips = await fetchTodaysSchedule();
    console.log(`CruiseDig: ${todaysShips.length} ship(s) today in SF`);
  } catch (err) {
    console.error('CruiseDig fetch error:', err.message);
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
      company: raw.company || guessCompany(raw.name),
      status: 'Scheduled',
      from: '—',
      to: '—',
      terminal: 'Pier 27',
      arrived: raw.eta_time || '—',
      eta_date: raw.eta_date || '—',
      eta_time: raw.eta_time || '—',
      etd_date: raw.etd_date || '—',
      etd_time: raw.etd_time || '—',
      etd_dateObj: raw.etd_dateObj || null,
      is_new: !knownIds.has(id)
    };
  });

  // Arrival notifications
  for (const ship of ships) {
    if (ship.is_new) {
      console.log(`New ship: ${ship.name} (${ship.company})`);
      await sendNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} · ${ship.company} · Docks: ${ship.eta_date} at ${ship.eta_time} · Departs: ${ship.etd_date} at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
    }
  }

  // Departure notifications — 5 min before
  for (const ship of ships) {
    const depId = `${ship.id}-departing`;
    if (isDepartingInFiveMinutes(ship.etd_dateObj) && !knownIds.has(depId)) {
      console.log(`${ship.name} departing in 5 minutes!`);
      await sendDepartureNotification(ship);
      addAlert({
        ship_name: ship.name,
        message: `${ship.name} leaving the bay in 5 minutes! Departing at ${ship.etd_time}`,
        sent_at: new Date().toISOString()
      });
      const s = ships.find(x => x.id === ship.id);
      if (s) s.id = depId;
    }
  }

  saveShipsInBay(ships);
  console.log(`Done. ${ships.length} ship(s). ${ships.filter(s => s.is_new).length} new.`);
  return ships;
}

function guessCompany(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CARNIVAL') || n.includes('LUMINOSA')) return 'Carnival Cruise Line';
  if (n.includes('PRINCESS') || n.includes('EMERALD') ||
      n.includes('RUBY') || n.includes('ISLAND')) return 'Princess Cruises';
  if (n.includes('CELEBRITY') || n.includes('SUMMIT')) return 'Celebrity Cruises';
  if (n.includes('NORWEGIAN') || n.includes('ENCORE') ||
      n.includes('BLISS') || n.includes('JADE')) return 'Norwegian Cruise Line';
  if (n.includes('ROYAL')) return 'Royal Caribbean';
  if (n.includes('HOLLAND') || n.includes('KONINGSDAM') ||
      n.includes('ZAANDAM') || n.includes('NIEUW') ||
      n.includes('OOSTERDAM') || n.includes('WESTERDAM') ||
      n.includes('NOORDAM') || n.includes('EURODAM')) return 'Holland America Line';
  if (n.includes('DISNEY')) return 'Disney Cruise Line';
  if (n.includes('VIKING')) return 'Viking Ocean Cruises';
  if (n.includes('VIRGIN') || n.includes('BRILLIANT')) return 'Virgin Voyages';
  return 'Cruise Line';
}

module.exports = { checkForNewShips };
