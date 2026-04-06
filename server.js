
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// 👉 SERVE FILE STATICI (fondamentale!)
app.use(express.static(__dirname));

// -------- PATH SICURI --------
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PROFILES_PATH = path.join(__dirname, 'profiles.json');
const STATE_PATH = path.join(__dirname, 'state.json');

// -------- LETTURA SICURA --------
function readJSON(filePath, fallback = null){
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch (e){
    console.error("Errore lettura:", filePath, e.message);
    return fallback;
  }
}

function writeJSON(filePath, data){
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// -------- INIT --------
let CONFIG = readJSON(CONFIG_PATH);
let PROFILES = readJSON(PROFILES_PATH)?.profiles || [];
let STATE = readJSON(STATE_PATH, {
  game: { status: "waiting", startedAt: null, endedAt: null },
  teams: []
});

// -------- UTILS --------
function shuffleArray(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genId(){
  return 'TEAM-' + Math.random().toString(36).substring(2,8).toUpperCase();
}

function saveState(){
  writeJSON(STATE_PATH, STATE);
}

// -------- API --------

app.get('/api/bootstrap', (req,res)=>{
  res.json({ config: CONFIG, profiles: PROFILES, state: STATE });
});

app.post('/api/teams', (req,res)=>{
  const { teamName, captain, players, profileId } = req.body;

  if(STATE.teams.length >= CONFIG.maxTeams){
    return res.status(400).json({ error: "Max squadre raggiunto" });
  }

  const profile = PROFILES.find(p => p.id === profileId);
  if(!profile) return res.status(400).json({ error: "Profilo non valido" });

  const sequence = shuffleArray([...Array(profile.clues.length).keys()]);

  const team = {
    id: genId(),
    teamName,
    captain,
    players,
    profileId,
    sequence,
    clueIndex: 0,
    status: "waiting",
    createdAt: Date.now()
  };

  STATE.teams.push(team);
  saveState();

  res.json({ team });
});

app.get('/api/teams/:id', (req,res)=>{
  const team = STATE.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: "Team non trovato" });

  const profile = PROFILES.find(p => p.id === team.profileId);

  const realIndex = team.sequence[team.clueIndex];
  const clue = profile.clues[realIndex];

  res.json({ team, profile, clue, game: STATE.game });
});

app.post('/api/teams/:id/verify-code', (req,res)=>{
  const team = STATE.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: "Team non trovato" });

  const profile = PROFILES.find(p => p.id === team.profileId);

  const realIndex = team.sequence[team.clueIndex];
  const clue = profile.clues[realIndex];

  const answer = (req.body.answer || '').toLowerCase();

  if(answer === clue.solution || (clue.solutionAliases || []).includes(answer)){
    team.clueIndex++;
    team.lastError = null;
  } else {
    team.lastError = "Risposta errata";
  }

  if(team.clueIndex >= profile.clues.length){
    team.status = "completed";
  } else if(STATE.game.status === "started"){
    team.status = "playing";
  }

  saveState();
  res.json({ ok: true });
});

// -------- ADMIN --------

app.post('/api/admin/start', (req,res)=>{
  STATE.game.status = "started";
  STATE.game.startedAt = Date.now();
  STATE.teams.forEach(t => {
    if(t.status === "waiting") t.status = "playing";
  });
  saveState();
  res.json({ ok:true });
});

app.post('/api/admin/end', (req,res)=>{
  STATE.game.status = "ended";
  STATE.game.endedAt = Date.now();
  saveState();
  res.json({ ok:true });
});

app.post('/api/admin/delete-team/:id', (req,res)=>{
  const team = STATE.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: "Team non trovato" });

  if(team.status === "playing"){
    return res.status(400).json({ error: "Non puoi cancellare una squadra in gioco" });
  }

  if(STATE.game.status !== "ended" && !["paused","completed"].includes(team.status)){
    return res.status(400).json({ error: "Cancellazione non consentita" });
  }

  STATE.teams = STATE.teams.filter(t => t.id !== req.params.id);
  saveState();

  res.json({ ok:true });
});

// -------- START --------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server attivo su porta", PORT);
});