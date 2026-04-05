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

/* =========================
   RESET GENERALE (MODIFICATO)
========================= */
app.post('/api/admin/reset', (req, res) => {
  const state = loadState();

  // elimina solo squadre concluse
  state.teams = state.teams
    .filter(team => team.status !== 'completed')
    .map(team => ({
      ...team,
      winner: false,
      lastError: null
    }));

  const hasPlaying = state.teams.some(t => t.status === 'playing');

  state.game.winnerTeamId = null;
  state.game.endedAt = null;

  if (hasPlaying) {
    state.game.status = 'started';
  } else {
    state.game.status = 'waiting';
    state.game.startedAt = null;
  }

  saveState(state);
  res.json({ ok: true });
});

/* =========================
   RESET S