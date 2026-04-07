const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   CONFIG BASE
========================= */

const config = {
  adminPassword: "1234",
  gameTitle: "Tesori della Tuscia",
  geoFocusMeters: 10
};

let game = {
  status: "waiting", // waiting | started | ended
  winnerTeamId: null
};

let teams = {};

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

/* =========================
   BOOTSTRAP
========================= */

app.get('/api/bootstrap', (req, res) => {
  res.json({
    config,
    profiles: [],
    state: {
      game,
      teams: Object.values(teams)
    }
  });
});

/* =========================
   TEAM CREAZIONE
========================= */

app.post('/api/teams', (req, res) => {
  const id = generateId();

  teams[id] = {
    id,
    teamName: req.body.teamName,
    captain: req.body.captain,
    players: req.body.players || [],
    profileId: req.body.profileId,

    status: "waiting", // stato iniziale
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
  const team = getTeam(req.params.id);

  res.json({
    team,
    game,
    profile: { label: team.profileId || "-", clues: [] }
  });
});

/* =========================
   ADMIN MONITOR
========================= */

app.get('/api/admin/monitor', (req, res) => {
  res.json({
    game,
    teams: Object.values(teams)
  });
});

/* =========================
   AVVIO PARTITA
========================= */

app.post('/api/admin/start', (req, res) => {
  game.status = "started";

  Object.values(teams).forEach(t => {
    if (t.status === "waiting") {
      t.status = "playing";
    }
  });

  res.json({ ok: true });
});

/* =========================
   CHIUSURA PARTITA GLOBALE
========================= */

app.post('/api/admin/end', (req, res) => {
  game.status = "ended";

  Object.values(teams).forEach(t => {
    if (t.status === "playing" || t.status === "paused") {
      t.status = "closed"; // 🔴 importante
    }
  });

  res.json({ ok: true });
});

/* =========================
   SOSPENDI SQUADRA
========================= */

app.post('/api/admin/pause-team/:id', (req, res) => {
  const t = getTeam(req.params.id);

  if (t.status === "playing") {
    t.status = "paused";
  }

  res.json({ ok: true });
});

/* =========================
   RIATTIVA SQUADRA
========================= */

app.post('/api/admin/resume-team/:id', (req, res) => {
  const t = getTeam(req.params.id);

  if (t.status === "paused") {
    t.status = "playing";
  }

  res.json({ ok: true });
});

/* =========================
   RESET SINGOLA SQUADRA
========================= */

app.post('/api/admin/reset-team/:id', (req, res) => {
  const t = getTeam(req.params.id);

  if (t.status === "completed" || t.status === "closed") {
    delete teams[req.params.id];
  } else {
    return res.status(400).json({
      error: "Puoi eliminare solo squadre concluse o chiuse"
    });
  }

  res.json({ ok: true });
});

/* =========================
   CANCELLA SQUADRA (solo sospesa)
========================= */

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

/* =========================
   RESET GLOBALE (PULIZIA)
========================= */

app.post('/api/admin/reset', (req, res) => {

  Object.keys(teams).forEach(id => {
    const t = teams[id];

    if (t.status === "completed" || t.status === "closed") {
      delete teams[id];
    }
  });

  res.json({ ok: true });
});

/* =========================
   SIMULAZIONE COMPLETAMENTO
========================= */

app.post('/api/teams/:id/complete', (req, res) => {
  const t = getTeam(req.params.id);

  t.status = "completed";
  t.completedAt = Date.now();

  if (!game.winnerTeamId) {
    t.winner = true;
    game.winnerTeamId = t.id;
  }

  res.json({ ok: true });
});

/* ========================= */

app.listen(PORT, () => {
  console.log("Server V4.0 attivo su porta", PORT);
});