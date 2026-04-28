const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load data.json, starting fresh');
  }
  return { ships: [], alerts: [], known_ids: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Could not save data.json:', e.message);
  }
}

let state = loadData();

function saveShipsInBay(ships) {
  state.ships = ships;
  state.known_ids = ships.map(s => s.id);
  state.last_updated = new Date().toISOString();
  saveData(state);
}

function getShipsInBay() {
  return state.ships || [];
}

function getKnownShipIds() {
  return new Set(state.known_ids || []);
}

function getUpcomingShips() {
  return state.upcoming || [];
}

function addAlert(alert) {
  if (!state.alerts) state.alerts = [];
  state.alerts.unshift(alert);
  if (state.alerts.length > 100) state.alerts = state.alerts.slice(0, 100);
  saveData(state);
}

function getAlerts() {
  return state.alerts || [];
}

module.exports = {
  saveShipsInBay,
  getShipsInBay,
  getKnownShipIds,
  getUpcomingShips,
  addAlert,
  getAlerts
};
