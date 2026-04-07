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
    const raw = fs.readFileSync(path.join(__dirname, 'profiles.json'), 'utf8');
    const json = JSON.parse(raw);
    profiles = Array.isArray(json.profiles) ? json.profiles : [];
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
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureString(value, fieldName) {
  const v = String(value || "").trim();
  if (!v) throw new Error(`${fieldName} obbligatorio`);
  return v;
}

function ensurePlayers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function ensureProfile(profileId) {
  const profile = getProfile(profileId);
  if (!profile) throw new Error("Profilo di gioco non trovato");
  if (!Array.isArray(profile.clues) || profile.clues.length === 0) {
    throw new Error("Profilo privo di indizi");
  }
  return profile;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/* =========================
   PERCORSO DIFFERENZIATO
========================= */

/*
  Obiettivo:
  - stesso obiettivo finale per tutte le squadre dello stesso profilo
  - sequenza precedente diversa per ogni squadra
  - ordine stabile nel tempo per ogni squadra
*/

function seededHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndices(length, seedString) {
  const arr = Array.from({ length }, (_, i) => i);
  const rand = mulberry32(seededHash(seedString));

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function buildTeamClueOrder(team, profile) {
  const total = Array.isArray(profile.clues) ? profile.clues.length : 0;

  if (total <= 1) {
    return [0];
  }

  const finalIndex = total - 1;
  const variableCount = total - 1;

  const prefixOrder = shuffledIndices(
    variableCount,
    `${team.id}|${team.profileId}|${team.teamName}|${team.captain}`
  );

  return [...prefixOrder, finalIndex];
}

function ensureTeamRoute(team, profile) {
  const total = Array.isArray(profile.clues) ? profile.clues.length : 0;

  if (
    !Array.isArray(team.clueOrder) ||
    team.clueOrder.length !== total ||
    new Set(team.clueOrder).size !== total ||
    team.clueOrder.some(i => !Number.isInteger(i) || i < 0 || i >= total)
  ) {
    team.clueOrder = buildTeamClueOrder(team, profile);
  }

  return team.clueOrder;
}

function getOrderedCluesForTeam(team, profile) {
  const clueOrder = ensureTeamRoute(team, profile);
  return clueOrder.map(index => profile.clues[index]);
}

function getEffectiveProfileForTeam(team) {
  const profile = ensureProfile(team.profileId);
  const orderedClues = getOrderedCluesForTeam(team, profile);

  return {
    ...profile,
    clues: orderedClues
  };
}

function getCurrentClueForTeam(team, profile) {
  const effectiveProfile = getEffectiveProfileForTeam(team);
  return effectiveProfile.clues[team.clueIndex] || null;
}

function clearTeamError(team) {
  team.lastError = null;
}

function completeTeamIfNeeded(team, profile) {
  if (team.clueIndex >= profile.clues.length) {
    team.status = "completed";
    team.completedAt = Date.now();

    if (!game.winnerTeamId) {
      team.winner = true;
      game.winnerTeamId = team.id;
    }
  }
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
      clueCount: Array.isArray(p.clues) ? p.clues.length : 0
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
  try {
    const teamName = ensureString(req.body.teamName, "Nome squadra");
    const captain = ensureString(req.body.captain, "Nome capitano");
    const players = ensurePlayers(req.body.players);
    const profile = ensureProfile(req.body.profileId);

    let id;
    do {
      id = generateId();
    } while (teams[id]);

    const team = {
      id,
      teamName,
      captain,
      players,
      profileId: profile.id,

      status: "waiting",
      clueIndex: 0,
      clueOrder: [],
      completedAt: null,
      winner: false,
      lastError: null
    };

    ensureTeamRoute(team, profile);

    teams[id] = team;

    res.json({ team: teams[id] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* =========================
   GET TEAM
========================= */

app.get('/api/teams/:id', (req, res) => {
  try {
    const team = getTeam(req.params.id);
    const profile = getEffectiveProfileForTeam(team);

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
    const baseProfile = ensureProfile(team.profileId);
    const profile = getEffectiveProfileForTeam(team);
    const clue = profile.clues[team.clueIndex];

    if (!clue) return res.json({ ok: true });

    if (team.status !== "playing") {
      return res.status(400).json({ error: "Squadra non attiva" });
    }

    const answer = normalizeText(req.body.answer);

    const validAnswers = [
      normalizeText(clue.solution),
      ...(Array.isArray(clue.solutionAliases) ? clue.solutionAliases.map(normalizeText) : [])
    ].filter(Boolean);

    const valid = validAnswers.includes(answer);

    if (valid) {
      clearTeamError(team);
      team.clueIndex++;

      completeTeamIfNeeded(team, baseProfile);

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
    const baseProfile = ensureProfile(team.profileId);
    const profile = getEffectiveProfileForTeam(team);
    const clue = profile.clues[team.clueIndex];

    if (!clue) return res.json({ ok: true });

    if (team.status !== "playing") {
      return res.status(400).json({ error: "Squadra non attiva" });
    }

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
      return res.status(400).json({ error: "Coordinate non valide" });
    }

    if (!isFiniteNumber(clue.lat) || !isFiniteNumber(clue.lng)) {
      return res.status(400).json({ error: "Indizio geografico non valido" });
    }

    const dist = distanceMeters(lat, lng, clue.lat, clue.lng);
    const radius = isFiniteNumber(clue.radius) ? clue.radius : config.geoFocusMeters;

    if (dist <= radius) {
      clearTeamError(team);
      team.clueIndex++;

      completeTeamIfNeeded(team, baseProfile);
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
    if (t.status === "waiting") {
      t.status = "playing";
      clearTeamError(t);
    }
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
  try {
    const t = getTeam(req.params.id);
    if (t.status === "playing") t.status = "paused";
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* RESUME */
app.post('/api/admin/resume-team/:id', (req, res) => {
  try {
    const t = getTeam(req.params.id);
    if (t.status === "paused") t.status = "playing";
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* DELETE (solo sospese) */
app.post('/api/admin/delete-team/:id', (req, res) => {
  try {
    const t = getTeam(req.params.id);

    if (t.status !== "paused") {
      return res.status(400).json({
        error: "Puoi cancellare solo squadre sospese"
      });
    }

    delete teams[req.params.id];
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* RESET SINGOLA */
app.post('/api/admin/reset-team/:id', (req, res) => {
  try {
    const t = getTeam(req.params.id);

    if (t.status === "completed" || t.status === "closed") {
      delete teams[req.params.id];
    } else {
      return res.status(400).json({
        error: "Solo squadre concluse o chiuse"
      });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
  console.log("Server V4.1 attivo su porta", PORT);
});