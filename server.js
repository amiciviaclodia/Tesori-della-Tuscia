app.post('/api/admin/reset', (req, res) => {
  const state = loadState();

  state.teams = state.teams
    .filter(team => team.status !== 'completed')
    .map(team => ({
      ...team,
      winner: false,
      lastError: null
    }));

  const hasPlayingTeams = state.teams.some(team => team.status === 'playing');

  state.game.winnerTeamId = null;
  state.game.endedAt = null;

  if (hasPlayingTeams) {
    state.game.status = 'started';
  } else {
    state.game.status = 'waiting';
    state.game.startedAt = null;
  }

  saveState(state);
  res.json({ ok: true });
});