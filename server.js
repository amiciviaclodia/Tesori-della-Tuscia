const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

/* =========================
   SERVE FRONTEND
========================= */

const publicPath = path.join(__dirname);

app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 3000;

const config = {
  adminPassword: "1234",
  gameTitle: "Tesori della Tuscia",
  geoFocusMeters: 10
};

/* =========================
   GAME STATE
========================= */

let game = {
  status: "waiting",
  winnerTeamId: null
};

let teams = {};

/* =========================
   CARICAMENTO PROFILI
========================= */

let profiles = [];

function loadProfiles() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'profiles.json'));
    const json = JSON.parse(raw);

    profiles = json.profiles || [];

    console.log("Profili caricati:", profiles.length);
  } catch (err) {
    console.error("Errore caricamento profiles.json:", err.message);
    profiles = [];
  }
}

loadProfiles();

/* =========================
   UTILS
========================= */

function generateId() {
  return "TEAM-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getTeam(id) {
  const t = teams[id];
  if (!t) throw new Error("Squadra non trovata");
  return t;
}

function getProfile(id) {
  return profiles.find(p => p.id === id);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* =========================
   BOOTSTRAP
========================= */

app.get('/api/bootstrap', (req, res) => {
  res.json({
    config,
    profiles: profiles.map(p => ({
      id: p.id,
      label: p.label,
      mode: p.mode,
      clueCount: p.clues.length
    })),
    state: {
      game,
      teams: Object.values(teams)
    }
  });
});

/* =========================
   CREATE TEAM
========================= */

app.post('/api/teams', (req, res) => {
  const id = generateId();

  teams[id] = {
    id,
    teamName: req.body.teamName,
    captain: req.body.captain,
    players: req.body.players || [],
    profileId: req.body.profileId,

    status: "waiting",
    clueIndex: 0,
    completedAt: null,
    winner: false,
    lastError: null
  };

  res.json({ team: teams[id] });
});

/* =========================
   GET TEAM
========================= */

app.get('/api/teams/:id', (req, res) => {
  try {
    const team = getTeam(req.params.id);
    const profile = getProfile(team.profileId);

    res.json({
      team,
      game,
      profile
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* =========================
   VERIFY CODE (URBANO)
========================= */

app.post('/api/teams/:id/verify-code', (req, res) => {
  try {
    const team = getTeam(req.params.id);
    const profile = getProfile(team.profileId);
    const clue = profile.clues[team.clueIndex];

    if (!clue) return res.json({ ok: true });

    if (team.status !== "playing") {
      return res.status(400).json({ error: "Squadra non attiva" });
    }

    const answer = (req.body.answer || "").toLowerCase().trim();

    const valid =
      answer === clue.solution ||
      (clue.solutionAliases || []).map(a => a.toLowerCase()).includes(answer);

    if (valid) {
      team.clueIndex++;

      if (team.clueIndex >= profile.clues.length) {
        team.status = "completed";
        team.completedAt = Date.now();

        if (!game.winnerTeamId) {
          team.winner = true;
          game.winnerTeamId = team.id;
        }
      }

      return res.json({ ok: true });
    } else {
      team.lastError = "Codice errato";
      return res.status(400).json({ error: "Codice errato" });
    }

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* =========================
   GEO CHECK (EXTRAURBANO)
========================= */

app.post('/api/teams/:id/geo-check', (req, res) => {
  try {
    const team = getTeam(req.params.id);
    const profile = getProfile(team.profileId);
    const clue = profile.clues[team.clueIndex];

    if (!clue) return res.json({ ok: true });

    if (team.status !== "playing") {
      return res.status(400).json({ error: "Squadra non attiva" });
    }

    const dist = distanceMeters(
      req.body.lat,
      req.body.lng,
      clue.lat,
      clue.lng
    );

    const radius = clue.radius || config.geoFocusMeters;

    if (dist <= radius) {
      team.clueIndex++;

      if (team.clueIndex >= profile.clues.length) {
        team.status = "completed";
        team.completedAt = Date.now();

        if (!game.winnerTeamId) {
          team.winner = true;
          game.winnerTeamId = team.id;
        }
      }
    }

    res.json({ ok: true });

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* =========================
   ADMIN
========================= */

app.get('/api/admin/monitor', (req, res) => {
  res.json({
    game,
    teams: Object.values(teams)
  });
});

/* START */
app.post('/api/admin/start', (req, res) => {
  game.status = "started";

  Object.values(teams).forEach(t => {
    if (t.status === "waiting") t.status = "playing";
  });

  res.json({ ok: true });
});

/* END */
app.post('/api/admin/end', (req, res) => {
  game.status = "ended";

  Object.values(teams).forEach(t => {
    if (t.status === "playing" || t.status === "paused") {
      t.status = "closed";
    }
  });

  res.json({ ok: true });
});

/* PAUSE */
app.post('/api/admin/pause-team/:id', (req, res) => {
  const t = getTeam(req.params.id);
  if (t.status === "playing") t.status = "paused";
  res.json({ ok: true });
});

/* RESUME */
app.post('/api/admin/resume-team/:id', (req, res) => {
  const t = getTeam(req.params.id);
  if (t.status === "paused") t.status = "playing";
  res.json({ ok: true });
});

/* DELETE (solo sospese) */
app.post('/api/admin/delete-team/:id', (req, res) => {
  const t = getTeam(req.params.id);

  if (t.status !== "paused") {
    return res.status(400).json({
      error: "Puoi cancellare solo squadre sospese"
    });
  }

  delete teams[req.params.id];
  res.json({ ok: true });
});

/* RESET SINGOLA */
app.post('/api/admin/reset-team/:id', (req, res) => {
  const t = getTeam(req.params.id);

  if (t.status === "completed" || t.status === "closed") {
    delete teams[req.params.id];
  } else {
    return res.status(400).json({
      error: "Solo squadre concluse o chiuse"
    });
  }

  res.json({ ok: true });
});

/* RESET GLOBALE */
app.post('/api/admin/reset', (req, res) => {

  Object.keys(teams).forEach(id => {
    const t = teams[id];

    if (t.status === "completed" || t.status === "closed") {
      delete teams[id];
    }
  });

  res.json({ ok: true });
});

/* ========================= */

app.listen(PORT, () => {
  console.log("Server V4.0 attivo su porta", PORT);
});