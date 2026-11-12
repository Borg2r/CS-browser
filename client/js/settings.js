// Match settings are authoritative. Saved choices only start an empty server.
const $ = id => document.getElementById(id);
const LEVELS = {
  easy: ['Easy', 'Slower reactions, less accurate aim and simpler combat movement.'],
  medium: ['Medium', 'Balanced reactions, aim and combat movement.'],
  hard: ['Hard', 'Quick reactions, accurate aim and more active strafing.'],
  expert: ['Expert', 'Fastest reactions, precise tracking and relentless pressure.'],
};

export class BotSettings {
  constructor(onChange, onResume, onMapChange) {
    this.onChange = onChange; this.onResume = onResume; this.onMapChange = onMapChange;
    this.state = null; this.pending = null; this.pendingMap = null;
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
      this.lastError = ''; $('difficulty-feedback').textContent = ''; this.renderDialog();
    };
    $('match-map').onchange = () => {
      this.lastError = ''; $('map-feedback').textContent = ''; this.renderDialog();
    };
    $('difficulty-apply').onclick = () => {
      const choice = $('match-difficulty').value;
      if (!this.state?.canChange || this.pending || choice === this.state.difficulty) return;
      this.lastError = ''; this.pending = choice;
      $('difficulty-feedback').textContent = 'Applying…';
      this.renderDialog(); this.onChange(choice);
    };
    $('map-apply').onclick = () => {
      const choice = $('match-map').value;
      if (!this.state?.canChange || this.pendingMap || !this.maps.some(m => m.id === choice) || choice === this.state.map) return;
      this.lastError = ''; this.pendingMap = choice;
      $('map-feedback').textContent = 'Starting new match…';
      this.renderDialog(); this.onMapChange(choice);
    };
    $('settings-resume').onclick = () => this.close();
    $('match-settings').addEventListener('cancel', e => { e.preventDefault(); this.close(false); });
  }

  get open() { return $('match-settings').open; }
  get joinPreference() { return this.state?.host == null ? $('difficulty').value : this.state.difficulty; }
  get joinMapPreference() { return this.state?.host == null ? $('map-select').value : this.state.map; }

  remember(value) {
    this.preference = value;
    try { localStorage.setItem('bp_difficulty', value); } catch { /* ignore */ }
  }
  rememberMap(value) {
    this.mapPreference = value;
    try { localStorage.setItem('bp_map', value); } catch { /* ignore */ }
  }
  setMaps(maps) {
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
    $('map-note').textContent = empty ? 'Choose your operation, then pick a side.' : 'Join the active operation. The host can change maps with F2.';
    this.describe('difficulty', 'difficulty-description');
    this.describeMap('map-select', 'map-description');
    if (this.pending) $('match-difficulty').value = this.pending;
    else if (!keepChoice) $('match-difficulty').value = state.difficulty;
    if (this.pendingMap) $('match-map').value = this.pendingMap;
    else if (!keepMap) $('match-map').value = state.map;
    const activeMap = this.maps.find(m => m.id === state.map);
    $('bot-settings-button').textContent = `${activeMap?.name || 'Match'} · ${LEVELS[state.difficulty][0]} · F2`;
    $('difficulty-feedback').textContent = this.lastError || (this.pending ? 'Applying…' : changed ? `${LEVELS[state.difficulty][0]} is active for all bots.` : '');
    $('map-feedback').textContent = this.lastError || (this.pendingMap ? 'Starting new match…' : mapChanged ? `${activeMap?.name || 'New map'} is ready. Back to game to play.` : '');
    this.renderDialog();
  }

  renderDialog() {
    this.describe('match-difficulty', 'match-difficulty-description');
    this.describeMap('match-map', 'match-map-description');
    $('match-difficulty').disabled = !this.state?.canChange || !!this.pending;
    $('match-map').disabled = !this.state?.canChange || !!this.pendingMap;
    $('difficulty-apply').disabled = !this.state?.canChange || !!this.pending || $('match-difficulty').value === this.state?.difficulty;
    $('map-apply').disabled = !this.state?.canChange || !!this.pendingMap || !this.maps.length || $('match-map').value === this.state?.map;
    $('difficulty-owner').textContent = this.state?.canChange
      ? 'You are the match host. You control the map and bot difficulty for everyone.'
      : `Shared by everyone. ${this.state?.hostName || 'The match host'} controls these settings.`;
  }
  show() {
    if (this.open) return;
    this.lastError = '';
    $('difficulty-feedback').textContent = ''; $('map-feedback').textContent = '';
    $('match-difficulty').value = this.pending || this.state?.difficulty || 'medium';
    $('match-map').value = this.pendingMap || this.state?.map || this.maps[0]?.id;
    this.renderDialog(); document.exitPointerLock?.();
    $('match-settings').showModal();
    (this.state?.canChange ? $('match-map') : $('settings-resume')).focus();
  }
  close(resume = true) {
    if (!this.open) return;
    $('match-settings').close();
    if (resume) this.onResume();
  }
  error(message) {
    this.pending = this.pendingMap = null;
    this.lastError = message || 'Could not change match settings.';
    this.renderDialog();
    $('difficulty-feedback').textContent = $('map-feedback').textContent = this.lastError;
  }
  disconnect() {
    this.close(false); this.state = null; this.pending = this.pendingMap = null; this.lastError = '';
    $('difficulty').disabled = $('map-select').disabled = true;
    $('difficulty-note').textContent = 'Connecting to the match…';
    $('bot-settings-button').textContent = 'Match settings · F2';
  }
}
