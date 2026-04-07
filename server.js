const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   CONFIG
========================= */

const config = {
  adminPassword: "1234",
  gameTitle: "Tesori della Tuscia",
  geoFocusMeters: 10
};

/* =========================
   GAME STATE
========================= */

let game = {
  status: "waiting", // waiting | started | ended
  winnerTeamId: null
};

let teams = {};

/* =========================
   PROFILI (SEMPLIFICATI)
   👉 usa i tuoi reali qui
========================= */

const profiles = [
  {
    id: "urbano",
    label: "Urbano",
    mode: "urbano",
    clues: [
      { title: "Indizio 1", text: "Trova la parola", answer: "altieri" }
    ]
  },
  {
    id: "extraurbano",
    label: "Extraurbano",
    mode: "extraurbano",
    clues: [
      { title: "Punto 1", text: "Raggiungi il punto", lat: 42.1, lng: 12.1 }
    ]
  }
];

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
   TEAM CREATE
========================= */

app.post('/api/teams', (req, res) => {
  const id = generateId();

  teams[id] = {
    id,
    teamName: req.body.teamName,
    captain: req.body.captain,
    players: req.body.players || [],
    profileId: req.body.profileId,

    status: "waiting", // waiting | playing | paused | completed | closed
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
      profile: {
        id: profile.id,
        label: profile.label,
        mode: profile.mode,
        clues: profile.clues
      }
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* =========================
   VERIFICA CODICE (URBANO)
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

    if (answer === clue.answer) {
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

    if (dist <= config.geoFocusMeters) {
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
      t.status = "closed"; // 🔴 fondamentale
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