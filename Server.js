const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

let game = {
  started: false,
  winnerTeamId: null
};

let teams = {};

/* =========================
   UTILITIES
========================= */

// 🔴 FIX PRINCIPALE
function recalculateWinner() {
  let winner = null;

  Object.values(teams).forEach(t => {
    if (t.completed) {
      if (!winner || t.completedAt < winner.completedAt) {
        winner = t;
      }
    }
  });

  game.winnerTeamId = winner ? winner.id : null;

  // riallineo flag locali
  Object.values(teams).forEach(t => {
    t.winner = winner && t.id === winner.id;
  });
}

// 🔴 FIX PRINCIPALE
function clearWinnerIfDeleted(teamId) {
  if (game.winnerTeamId === teamId) {
    recalculateWinner();
  }
}

/* =========================
   GAME CONTROL
========================= */

app.post("/api/admin/start", (req, res) => {
  game.started = true;

  // 🔴 reset vincitore
  game.winnerTeamId = null;

  Object.values(teams).forEach(t => {
    t.winner = false;
    t.completed = false;
    t.completedAt = null;
  });

  res.json({ ok: true });
});

app.post("/api/admin/end", (req, res) => {
  game.started = false;

  // 🔴 riallinea vincitore
  recalculateWinner();

  res.json({ ok: true });
});

app.post("/api/admin/reset", (req, res) => {
  teams = {};

  // 🔴 reset totale
  game.winnerTeamId = null;

  res.json({ ok: true });
});

/* =========================
   TEAM MANAGEMENT
========================= */

app.post("/api/team", (req, res) => {
  const id = "TEAM-" + Math.random().toString(36).substring(2, 8).toUpperCase();

  teams[id] = {
    id,
    name: req.body.name || id,
    players: req.body.players || [],
    score: 0,
    completed: false,
    completedAt: null,
    winner: false
  };

  res.json(teams[id]);
});

app.delete("/api/admin/delete-team/:id", (req, res) => {
  const id = req.params.id;

  if (teams[id]) {
    clearWinnerIfDeleted(id);
    delete teams[id];
  }

  res.json({ ok: true });
});

app.post("/api/admin/reset-team/:id", (req, res) => {
  const id = req.params.id;

  if (teams[id]) {
    clearWinnerIfDeleted(id);

    teams[id].score = 0;
    teams[id].completed = false;
    teams[id].completedAt = null;
    teams[id].winner = false;
  }

  res.json({ ok: true });
});

/* =========================
   GAMEPLAY
========================= */

app.post("/api/team/:id/score", (req, res) => {
  const team = teams[req.params.id];
  if (!team) return res.status(404).send("Team not found");

  team.score += req.body.points || 0;

  res.json(team);
});

app.post("/api/team/:id/complete", (req, res) => {
  const team = teams[req.params.id];
  if (!team) return res.status(404).send("Team not found");

  if (!team.completed) {
    team.completed = true;
    team.completedAt = Date.now();

    // 🔴 assegna vincitore solo se non esiste
    if (!game.winnerTeamId) {
      team.winner = true;
      game.winnerTeamId = team.id;
    }
  }

  res.json(team);
});

/* =========================
   STATUS
========================= */

app.get("/api/status", (req, res) => {
  res.json({
    game,
    teams: Object.values(teams)
  });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});