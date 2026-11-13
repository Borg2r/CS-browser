// Match settings are authoritative. Saved choices only start an empty server.
const $ = id => document.getElementById(id);
const LEVELS = {
  easy: ['Easy', 'Slower reactions, less accurate aim and simpler combat movement.'],
  medium: ['Medium', 'Balanced reactions, aim and combat movement.'],
  hard: ['Hard', 'Quick reactions, accurate aim and more active strafing.'],
  expert: ['Expert', 'Fastest reactions, precise tracking and relentless pressure.'],
};

export class BotSettings {
  constructor(onChange, onResume, onMapChange, onRoundAction) {
    this.onChange = onChange; this.onResume = onResume; this.onMapChange = onMapChange; this.onRoundAction = onRoundAction;
    this.state = null; this.pending = null; this.pendingMap = null;
    this.round = null; this.pendingRound = null; this.roundCache = ''; this.roundMessage = ''; this.roundMessageState = '';
    this.preference = null; this.mapPreference = null; this.maps = []; this.lastError = '';
    try {
      const saved = localStorage.getItem('bp_difficulty');
      if (Object.hasOwn(LEVELS, saved)) this.preference = saved;
      this.mapPreference = localStorage.getItem('bp_map');
    } catch { /* Storage is optional for guests. */ }
    $('difficulty').value = this.preference || 'medium';
    this.describe('difficulty', 'difficulty-description');
    $('difficulty').onchange = () => {
      this.remember($('difficulty').value);
      this.describe('difficulty', 'difficulty-description');
    };
    $('map-select').onchange = () => {
      this.rememberMap($('map-select').value); this.describeMap('map-select', 'map-description');
    };
    $('match-difficulty').onchange = () => {
      this.lastError = ''; this.feedback('difficulty-feedback', ''); this.renderDialog();
    };
    $('match-map').onchange = () => {
      this.lastError = ''; this.feedback('map-feedback', ''); this.renderDialog();
    };
    $('difficulty-apply').onclick = () => {
      const choice = $('match-difficulty').value;
      if (!this.state?.canChange || this.busy || choice === this.state.difficulty) return;
      this.lastError = ''; this.pending = choice;
      this.feedback('difficulty-feedback', 'Applying…', 'pending');
      this.renderDialog(); this.onChange(choice);
    };
    $('map-apply').onclick = () => {
      const choice = $('match-map').value;
      if (!this.state?.canChange || this.busy || !this.maps.some(m => m.id === choice) || choice === this.state.map) return;
      this.lastError = ''; this.pendingMap = choice;
      this.feedback('map-feedback', 'Starting new match…', 'pending');
      this.renderDialog(); this.onMapChange(choice);
    };
    $('round-restart').onclick = () => this.requestRound('restart');
    $('round-skip').onclick = () => this.requestRound('skip');
    $('settings-resume').onclick = () => this.close();
    $('match-settings').addEventListener('cancel', e => { e.preventDefault(); this.close(); });
  }

  get open() { return $('match-settings').open; }
  get busy() { return !!(this.pending || this.pendingMap || this.pendingRound || this.round?.skipping); }
  get joinPreference() { return this.state?.host == null ? $('difficulty').value : this.state.difficulty; }
  get joinMapPreference() { return this.state?.host == null ? $('map-select').value : this.state.map; }

  feedback(id, message, state = '') {
    const element = $(id);
    if (element.textContent !== message) element.textContent = message;
    element.dataset.state = message ? state : '';
  }
  resetRound() {
    this.round = null; this.pendingRound = null; this.roundCache = '';
    this.roundMessage = ''; this.roundMessageState = '';
  }

  remember(value) {
    this.preference = value;
    try { localStorage.setItem('bp_difficulty', value); } catch { /* ignore */ }
  }
  rememberMap(value) {
    this.mapPreference = value;
    try { localStorage.setItem('bp_map', value); } catch { /* ignore */ }
  }
  setMaps(maps) {
    // A fresh hello can replace the map; never reuse its previous round token.
    this.resetRound();
    this.maps = maps || [];
    for (const id of ['map-select', 'match-map']) {
      const select = $(id), choice = select.value;
      select.replaceChildren(...this.maps.map(map => new Option(map.name, map.id)));
      if (this.maps.some(m => m.id === choice)) select.value = choice;
    }
    if (!this.maps.some(m => m.id === this.mapPreference)) this.mapPreference = null;
    if (this.state) this.update(this.state);
  }
  describe(selectId, descriptionId) {
    $(descriptionId).textContent = LEVELS[$(selectId).value]?.[1] || '';
  }
  describeMap(selectId, descriptionId) {
    const map = this.maps.find(m => m.id === $(selectId).value);
    $(descriptionId).textContent = map?.description || '';
    if (selectId === 'map-select') $('map-brief').dataset.theme = map?.theme || 'desert';
  }

  update(state) {
    if (!Object.hasOwn(LEVELS, state.difficulty)) return;
    const previous = this.state, requested = this.pending, requestedMap = this.pendingMap;
    this.state = state;
    if (requested === state.difficulty && state.canChange) this.remember(state.difficulty);
    if (requestedMap === state.map && state.canChange) this.rememberMap(state.map);
    const changed = previous && previous.difficulty !== state.difficulty;
    const mapChanged = previous && previous.map !== state.map;
    if (mapChanged) this.resetRound();
    if (changed || mapChanged || previous?.host !== state.host) this.lastError = '';
    this.pending = state.canChange && requested !== state.difficulty ? requested : null;
    this.pendingMap = state.canChange && requestedMap !== state.map ? requestedMap : null;
    const keepChoice = this.open && previous?.canChange && state.canChange && !changed && !requested;
    const keepMap = this.open && previous?.canChange && state.canChange && !mapChanged && !requestedMap;
    const empty = state.host == null;
    $('difficulty').disabled = $('map-select').disabled = !empty;
    $('difficulty').value = empty ? this.preference || state.difficulty : state.difficulty;
    $('map-select').value = empty ? this.mapPreference || state.map : state.map;
    $('difficulty-note').textContent = empty
      ? 'First player chooses the map and bot level for everyone.'
      : `Shared match · ${state.hostName || 'The host'} controls maps and bots.`;
    $('map-note').textContent = empty ? 'Choose your operation, then pick a side.' : 'Join the active operation. Open the pause menu with Esc or F2.';
    this.describe('difficulty', 'difficulty-description');
    this.describeMap('map-select', 'map-description');
    if (this.pending) $('match-difficulty').value = this.pending;
    else if (!keepChoice) $('match-difficulty').value = state.difficulty;
    if (this.pendingMap) $('match-map').value = this.pendingMap;
    else if (!keepMap) $('match-map').value = state.map;
    const activeMap = this.maps.find(m => m.id === state.map);
    $('bot-settings-button').textContent = `${activeMap?.name || 'Match'} · ${LEVELS[state.difficulty][0]} · Esc / F2`;
    this.feedback('difficulty-feedback', this.lastError || (this.pending ? 'Applying…' : changed ? `${LEVELS[state.difficulty][0]} is active for all bots.` : ''), this.lastError ? 'error' : this.pending ? 'pending' : 'success');
    this.feedback('map-feedback', this.lastError || (this.pendingMap ? 'Starting new match…' : mapChanged ? `${activeMap?.name || 'New map'} is ready. Back to game to play.` : ''), this.lastError ? 'error' : this.pendingMap ? 'pending' : 'success');
    this.renderDialog();
  }

  updateRound(snapshot) {
    if (!Number.isInteger(snapshot?.roundId)) {
      if (this.round) { this.resetRound(); this.renderDialog(); }
      return;
    }
    const next = {roundId:snapshot.roundId, canRestart:!!snapshot.canRestart, canSkip:!!snapshot.canSkip, skipping:!!snapshot.skipping, number:snapshot.rd, map:snapshot.map};
    const cache = [next.roundId, +next.canRestart, +next.canSkip, +next.skipping, next.number, next.map].join('|');
    if (cache === this.roundCache) return;
    const previous = this.round, requested = this.pendingRound;
    const changedMap = previous?.map && next.map && previous.map !== next.map;
    if (changedMap) {
      this.pendingRound = null; this.roundMessage = ''; this.roundMessageState = '';
    } else if (previous && previous.roundId !== next.roundId) {
      this.pendingRound = null;
      this.roundMessage = requested?.action === 'restart' ? 'Round restarted.' : requested?.action === 'skip' || previous.skipping ? 'Bot round finished. The next round is ready.' : '';
      this.roundMessageState = this.roundMessage ? 'success' : '';
    }
    if (next.skipping) {
      this.roundMessage = 'Finishing bot round…'; this.roundMessageState = 'pending';
    }
    this.round = next; this.roundCache = cache;
    this.renderDialog();
  }
  requestRound(action) {
    if (this.busy || !this.round || typeof this.onRoundAction !== 'function') return;
    if (action === 'restart' ? !this.round.canRestart : action !== 'skip' || !this.round.canSkip) return;
    this.pendingRound = {action, roundId:this.round.roundId};
    this.roundMessage = action === 'restart' ? 'Restarting round…' : 'Finishing bot round…';
    this.roundMessageState = 'pending';
    this.renderDialog(); this.onRoundAction(action, this.round.roundId);
  }
  renderRound() {
    const round = this.round, restart = $('round-restart'), skip = $('round-skip');
    const available = typeof this.onRoundAction === 'function';
    restart.disabled = !available || this.busy || !round?.canRestart;
    skip.disabled = !available || this.busy || !round?.canSkip;
    const restarting = this.pendingRound?.action === 'restart';
    const skipping = this.pendingRound?.action === 'skip' || !!round?.skipping;
    restart.textContent = restarting ? 'Restarting…' : 'Restart round';
    skip.textContent = skipping ? 'Finishing…' : 'Skip bot-only round';
    restart.setAttribute('aria-busy', String(restarting)); skip.setAttribute('aria-busy', String(skipping));
    restart.title = round?.canRestart ? 'Restore the beginning of this round.' : 'Only the host can restart during an active round.';
    skip.title = round?.canSkip ? 'Finish the bot-only round quickly.' : 'Available to eliminated players when all humans are out and bots remain.';
    const prefix = Number.isFinite(round?.number) ? `Round ${round.number} · ` : '';
    const status = !round ? 'Round controls become available after you join.'
      : round.skipping ? 'Bots are finishing this round. The next round starts automatically.'
      : round.canSkip ? `${prefix}Only bots remain. You can finish this round quickly.`
      : `${prefix}Skip is available when all human players are out and bots remain.`;
    if ($('round-status').textContent !== status) $('round-status').textContent = status;
    this.feedback('round-feedback', this.roundMessage, this.roundMessageState);
  }

  renderDialog() {
    this.describe('match-difficulty', 'match-difficulty-description');
    this.describeMap('match-map', 'match-map-description');
    $('match-difficulty').disabled = $('match-map').disabled = !this.state?.canChange || this.busy;
    $('difficulty-apply').disabled = !this.state?.canChange || this.busy || $('match-difficulty').value === this.state?.difficulty;
    $('map-apply').disabled = !this.state?.canChange || this.busy || !this.maps.length || $('match-map').value === this.state?.map;
    $('difficulty-apply').setAttribute('aria-busy', String(!!this.pending));
    $('map-apply').setAttribute('aria-busy', String(!!this.pendingMap));
    $('difficulty-owner').textContent = this.state?.canChange
      ? 'You are the host. Map and difficulty changes apply to everyone.'
      : `${this.state?.hostName || 'The match host'} controls the map, difficulty and round restart.`;
    this.renderRound();
  }
  show() {
    if (this.open) return;
    this.lastError = '';
    this.feedback('difficulty-feedback', this.pending ? 'Applying…' : '', this.pending ? 'pending' : '');
    this.feedback('map-feedback', this.pendingMap ? 'Starting new match…' : '', this.pendingMap ? 'pending' : '');
    $('match-difficulty').value = this.pending || this.state?.difficulty || 'medium';
    $('match-map').value = this.pendingMap || this.state?.map || this.maps[0]?.id;
    this.renderDialog(); document.exitPointerLock?.();
    $('match-settings').showModal();
    $('settings-resume').focus();
  }
  close(resume = true) {
    if (!this.open) return;
    $('match-settings').close();
    if (resume) this.onResume?.();
  }
  error(message) {
    this.pending = this.pendingMap = null;
    this.lastError = message || 'Could not change match settings.';
    this.renderDialog();
    this.feedback('difficulty-feedback', this.lastError, 'error');
    this.feedback('map-feedback', this.lastError, 'error');
  }
  roundError(message) {
    this.pendingRound = null;
    this.roundMessage = message || 'Could not change this round.'; this.roundMessageState = 'error';
    this.renderDialog();
  }
  disconnect() {
    this.close(false); this.state = null; this.pending = this.pendingMap = null; this.lastError = '';
    this.resetRound();
    this.feedback('difficulty-feedback', ''); this.feedback('map-feedback', '');
    this.renderDialog();
    $('difficulty').disabled = $('map-select').disabled = true;
    $('difficulty-note').textContent = 'Connecting to the match…';
    $('bot-settings-button').textContent = 'Pause menu · Esc / F2';
  }
}
