const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data){
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadState(){ return readJson(STATE_FILE); }
function saveState(state){ writeJson(STATE_FILE, state); }
function loadConfig(){ return readJson(CONFIG_FILE); }
function loadProfiles(){ return readJson(PROFILES_FILE); }

function sanitizeTeam(team){
  return {
    id: team.id,
    teamName: team.teamName,
    captain: team.captain,
    playersCount: team.playersCount,
    players: team.players,
    profileId: team.profileId,
    clueIndex: team.clueIndex,
    status: team.status,
    createdAt: team.createdAt,
    startedAt: team.startedAt || null,
    completedAt: team.completedAt || null,
    winner: !!team.winner,
    lastError: team.lastError || null
  };
}

app.get('/api/bootstrap', (req, res) => {
  const config = loadConfig();
  const profiles = loadProfiles();
  const state = loadState();
  res.json({
    config: {
      gameTitle: config.gameTitle,
      adminPassword: config.adminPassword,
      whatsappNumber: config.whatsappNumber,
      maxTeams: config.maxTeams,
      maxPlayersPerTeam: config.maxPlayersPerTeam,
      geoFocusMeters: config.geoFocusMeters
    },
    profiles: profiles.profiles.map(p => ({
      id: p.id,
      label: p.label,
      mode: p.mode,
      country: p.country,
      clueCount: p.clues.length
    })),
    state: {
      game: state.game,
      teams: state.teams.map(sanitizeTeam)
    }
  });
});

app.post('/api/teams', (req, res) => {
  const state = loadState();
  const config = loadConfig();
  const profiles = loadProfiles();
  const { teamName, captain, players, profileId } = req.body || {};

  if (state.teams.length >= config.maxTeams) {
    return res.status(400).json({ error: 'Numero massimo di squadre raggiunto.' });
  }
  if (!teamName || !captain || !Array.isArray(players) || players.length < 1) {
    return res.status(400).json({ error: 'Dati squadra incompleti.' });
  }
  if (players.length > config.maxPlayersPerTeam) {
    return res.status(400).json({ error: 'Troppi giocatori per squadra.' });
  }
  const profile = profiles.profiles.find(p => p.id === profileId);
  if (!profile) {
    return res.status(400).json({ error: 'Profilo non valido.' });
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'TEAM-';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];

  const team = {
    id,
    teamName: String(teamName).trim(),
    captain: String(captain).trim(),
    playersCount: players.length,
    players: players.map(v => String(v).trim()).filter(Boolean).slice(0, config.maxPlayersPerTeam),
    profileId,
    clueIndex: 0,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    winner: false,
    lastError: null
  };

  state.teams.push(team);
  saveState(state);
  res.json({ ok: true, team: sanitizeTeam(team) });
});

app.get('/api/teams/:id', (req, res) => {
  const state = loadState();
  const profiles = loadProfiles();
  const team = state.teams.find(t => t.id === req.params.id.toUpperCase());
  if (!team) return res.status(404).json({ error: 'Squadra non trovata.' });
  const profile = profiles.profiles.find(p => p.id === team.profileId);
  res.json({
    team: sanitizeTeam(team),
    game: state.game,
    profile: profile ? {
      id: profile.id,
      label: profile.label,
      mode: profile.mode,
      country: profile.country,
      clues: profile.clues
    } : null
  });
});

app.post('/api/teams/:id/verify-code', (req, res) => {
  const state = loadState();
  const profiles = loadProfiles();
  const team = state.teams.find(t => t.id === req.params.id.toUpperCase());
  if (!team) return res.status(404).json({ error: 'Squadra non trovata.' });
  if (state.game.status !== 'started') return res.status(400).json({ error: 'La partita non è attiva.' });
  if (team.status === 'completed') return res.status(400).json({ error: 'Squadra già completata.' });

  const profile = profiles.profiles.find(p => p.id === team.profileId);
  if (!profile) return res.status(400).json({ error: 'Profilo non trovato.' });
  if (profile.mode !== 'urbano') return res.status(400).json({ error: 'Questo profilo usa la geolocalizzazione, non i codici.' });

  const clue = profile.clues[team.clueIndex];
  const answer = String((req.body && req.body.answer) || '').trim().toLowerCase();
  const solutions = (clue.solutionAliases && clue.solutionAliases.length ? clue.solutionAliases : [clue.solution])
    .map(v => String(v).trim().toLowerCase());

  if (!solutions.includes(answer)) {
    team.lastError = 'Codice non corretto.';
    saveState(state);
    return res.status(400).json({ error: 'Codice non corretto.' });
  }

  team.lastError = null;
  team.clueIndex += 1;

  if (team.clueIndex >= profile.clues.length) {
    team.status = 'completed';
    team.completedAt = Date.now();
    if (!state.game.winnerTeamId) {
      state.game.winnerTeamId = team.id;
      team.winner = true;
    }
  } else {
    team.status = 'playing';
  }

  saveState(state);
  res.json({ ok: true, team: sanitizeTeam(team) });
});

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.post('/api/teams/:id/geo-check', (req, res) => {
  const state = loadState();
  const profiles = loadProfiles();
  const config = loadConfig();
  const team = state.teams.find(t => t.id === req.params.id.toUpperCase());
  if (!team) return res.status(404).json({ error: 'Squadra non trovata.' });
  if (state.game.status !== 'started') return res.status(400).json({ error: 'La partita non è attiva.' });
  if (team.status === 'completed') return res.status(400).json({ error: 'Squadra già completata.' });

  const profile = profiles.profiles.find(p => p.id === team.profileId);
  if (!profile) return res.status(400).json({ error: 'Profilo non trovato.' });
  if (profile.mode !== 'extraurbano') return res.status(400).json({ error: 'Questo profilo usa i codici, non la geolocalizzazione.' });

  const clue = profile.clues[team.clueIndex];
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Coordinate mancanti.' });
  }

  const radius = clue.radius || config.geoFocusMeters;
  const distance = haversineMeters(lat, lng, clue.lat, clue.lng);

  if (distance > radius) {
    team.lastError = `Sei ancora a ${Math.round(distance)} m dal punto.`;
    saveState(state);
    return res.status(400).json({ error: 'Punto non raggiunto.', distance: Math.round(distance), radius });
  }

  team.lastError = null;
  team.clueIndex += 1;

  if (team.clueIndex >= profile.clues.length) {
    team.status = 'completed';
    team.completedAt = Date.now();
    if (!state.game.winnerTeamId) {
      state.game.winnerTeamId = team.id;
      team.winner = true;
    }
  } else {
    team.status = 'playing';
  }

  saveState(state);
  res.json({ ok: true, team: sanitizeTeam(team), distance: Math.round(distance) });
});

app.post('/api/admin/start', (req, res) => {
  const state = loadState();
  state.game.status = 'started';
  state.game.startedAt = Date.now();
  state.game.endedAt = null;
  state.game.winnerTeamId = null;
  state.teams = state.teams.map(team => ({
    ...team,
    clueIndex: 0,
    status: 'playing',
    startedAt: Date.now(),
    completedAt: null,
    winner: false,
    lastError: null
  }));
  saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/end', (req, res) => {
  const state = loadState();
  state.game.status = 'ended';
  state.game.endedAt = Date.now();
  saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/reset', (req, res) => {
  const state = {
    game: {
      status: 'waiting',
      startedAt: null,
      endedAt: null,
      winnerTeamId: null
    },
    teams: []
  };
  saveState(state);
  res.json({ ok: true });
});

app.get('/api/admin/monitor', (req, res) => {
  const state = loadState();
  res.json({
    game: state.game,
    teams: state.teams.map(sanitizeTeam)
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tesori della Tuscia V3.1 attivo su http://localhost:${PORT}`);
});
