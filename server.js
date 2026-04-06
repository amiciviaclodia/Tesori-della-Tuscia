
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname,'config.json')));
const PROFILES = JSON.parse(fs.readFileSync(path.join(__dirname,'profiles.json'))).profiles;

function loadState(){
  return JSON.parse(fs.readFileSync(path.join(__dirname,'state.json')));
}
function saveState(s){
  fs.writeFileSync(path.join(__dirname,'state.json'), JSON.stringify(s,null,2));
}

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

function getProfile(id){
  return PROFILES.find(p => p.id === id);
}

app.get('/api/bootstrap', (req,res)=>{
  const state = loadState();
  res.json({ config: CONFIG, profiles: PROFILES, state });
});

app.post('/api/teams', (req,res)=>{
  const state = loadState();
  if(state.teams.length >= CONFIG.maxTeams){
    return res.status(400).json({ error: 'Numero massimo di squadre raggiunto' });
  }
  const { teamName, captain, players, profileId } = req.body;
  const profile = getProfile(profileId);
  if(!profile) return res.status(400).json({ error: 'Profilo non valido' });

  const sequence = shuffleArray([...Array(profile.clues.length).keys()]);

  const team = {
    id: genId(),
    teamName,
    captain,
    players: players || [],
    profileId,
    sequence,            // V4.0
    clueIndex: 0,
    status: 'waiting',
    createdAt: Date.now()
  };

  state.teams.push(team);
  saveState(state);
  res.json({ team });
});

app.get('/api/teams/:id', (req,res)=>{
  const state = loadState();
  const team = state.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: 'Team non trovato' });
  const profile = getProfile(team.profileId);

  const realIndex = team.sequence ? team.sequence[team.clueIndex] : team.clueIndex;
  const clue = profile.clues[realIndex];

  res.json({ team, profile, game: state.game, clue });
});

app.post('/api/teams/:id/verify-code', (req,res)=>{
  const state = loadState();
  const team = state.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: 'Team non trovato' });
  const profile = getProfile(team.profileId);

  const realIndex = team.sequence ? team.sequence[team.clueIndex] : team.clueIndex;
  const clue = profile.clues[realIndex];

  const ans = (req.body.answer || '').toLowerCase().trim();
  const ok = (clue.solution && (ans === clue.solution || (clue.solutionAliases||[]).includes(ans)));

  if(ok){
    team.clueIndex++;
    team.lastError = null;
  } else {
    team.lastError = 'Risposta non corretta';
  }

  if(team.clueIndex >= profile.clues.length){
    team.status = 'completed';
    team.completedAt = Date.now();
  } else if(state.game.status === 'started'){
    team.status = 'playing';
  }

  saveState(state);
  res.json({ ok });
});

app.post('/api/admin/start', (req,res)=>{
  const state = loadState();
  state.game.status = 'started';
  state.game.startedAt = Date.now();
  state.teams.forEach(t => { if(t.status === 'waiting') t.status = 'playing'; });
  saveState(state);
  res.json({ ok:true });
});

app.post('/api/admin/end', (req,res)=>{
  const state = loadState();
  state.game.status = 'ended';
  state.game.endedAt = Date.now();
  saveState(state);
  res.json({ ok:true });
});

app.post('/api/admin/pause-team/:id', (req,res)=>{
  const state = loadState();
  const team = state.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: 'Team non trovato' });
  team.status = 'paused';
  saveState(state);
  res.json({ ok:true });
});

app.post('/api/admin/resume-team/:id', (req,res)=>{
  const state = loadState();
  const team = state.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: 'Team non trovato' });
  team.status = 'playing';
  saveState(state);
  res.json({ ok:true });
});

app.post('/api/admin/delete-team/:id', (req,res)=>{
  const state = loadState();
  const team = state.teams.find(t => t.id === req.params.id);
  if(!team) return res.status(404).json({ error: 'Team non trovato' });

  if(team.status === 'playing'){
    return res.status(400).json({ error: 'Non puoi cancellare una squadra in gioco' });
  }
  if(state.game.status !== 'ended' && !['paused','completed'].includes(team.status)){
    return res.status(400).json({ error: 'Puoi cancellare solo squadre sospese, completate o a partita chiusa' });
  }

  state.teams = state.teams.filter(t => t.id !== req.params.id);
  saveState(state);
  res.json({ ok:true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server V4.0 attivo su porta', PORT));
