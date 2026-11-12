// Bot difficulty is shared by the match; personal defaults are only a preference
// for starting an empty server. The server decides who can change a live match.
const $ = id => document.getElementById(id);
const LEVELS = {
  easy: ['Easy', 'Slower reactions, less accurate aim and simpler combat movement.'],
  medium: ['Medium', 'Balanced reactions, aim and combat movement.'],
  hard: ['Hard', 'Quick reactions, accurate aim and more active strafing.'],
  expert: ['Expert', 'Fastest reactions, precise tracking and relentless pressure.'],
};

export class BotSettings {
  constructor(onChange, onResume) {
    this.onChange = onChange; this.onResume = onResume;
    this.state = null; this.pending = null; this.preference = null; this.lastError = '';
    try {
      const saved = localStorage.getItem('bp_difficulty');
      if (Object.hasOwn(LEVELS, saved)) this.preference = saved;
    } catch { /* Storage is optional for guests. */ }
    $('difficulty').value = this.preference || 'medium';
    this.describe('difficulty', 'difficulty-description');
    $('difficulty').onchange = () => {
      this.remember($('difficulty').value);
      this.describe('difficulty', 'difficulty-description');
    };
    $('match-difficulty').onchange = () => {
      this.lastError = ''; $('difficulty-feedback').textContent = ''; this.renderDialog();
    };
    $('difficulty-apply').onclick = () => {
      const choice = $('match-difficulty').value;
      if (!this.state?.canChange || this.pending || choice === this.state.difficulty) return;
      this.lastError = '';
      this.pending = choice;
      $('difficulty-feedback').textContent = 'Applying…';
      this.renderDialog();
      this.onChange(choice);
    };
    $('settings-resume').onclick = () => this.close();
    $('match-settings').addEventListener('cancel', e => { e.preventDefault(); this.close(false); });
  }

  get open() { return $('match-settings').open; }
  get joinPreference() { return this.state?.host == null ? $('difficulty').value : this.state.difficulty; }

  remember(value) {
    this.preference = value;
    try { localStorage.setItem('bp_difficulty', value); } catch { /* ignore */ }
  }

  describe(selectId, descriptionId) {
    const value = $(selectId).value;
    $(descriptionId).textContent = LEVELS[value]?.[1] || '';
  }

  update(state) {
    if (!Object.hasOwn(LEVELS, state.difficulty)) return;
    const previous = this.state;
    const requested = this.pending;
    this.state = state;
    if (requested === state.difficulty && state.canChange) this.remember(state.difficulty);
    const changed = previous && previous.difficulty !== state.difficulty;
    if (changed || previous?.host !== state.host) this.lastError = '';
    this.pending = state.canChange && requested !== state.difficulty ? requested : null;
    const keepChoice = this.open && previous?.canChange && state.canChange && !changed && !requested;
    const empty = state.host == null;
    $('difficulty').disabled = !empty;
    $('difficulty').value = empty ? this.preference || state.difficulty : state.difficulty;
    $('difficulty-note').textContent = empty
      ? 'First player chooses the bot level for everyone.'
      : `Shared match · ${state.hostName || 'The host'} controls bot difficulty.`;
    this.describe('difficulty', 'difficulty-description');
    if (this.pending) $('match-difficulty').value = this.pending;
    else if (!keepChoice) $('match-difficulty').value = state.difficulty;
    $('bot-settings-button').textContent = `Bots: ${LEVELS[state.difficulty][0]} · F2`;
    $('difficulty-feedback').textContent = this.lastError || (this.pending ? 'Applying…' : changed ? `${LEVELS[state.difficulty][0]} is active for all bots.` : '');
    this.renderDialog();
  }

  renderDialog() {
    this.describe('match-difficulty', 'match-difficulty-description');
    $('match-difficulty').disabled = !this.state?.canChange || this.pending;
    $('difficulty-apply').disabled = !this.state?.canChange || this.pending || $('match-difficulty').value === this.state?.difficulty;
    $('difficulty-owner').textContent = this.state?.canChange
      ? 'You are the match host. Changes apply immediately to bots on both teams.'
      : `Shared by everyone. ${this.state?.hostName || 'The match host'} controls this setting.`;
  }

  show() {
    if (this.open) return;
    this.lastError = '';
    $('difficulty-feedback').textContent = '';
    $('match-difficulty').value = this.state?.difficulty || 'medium';
    this.renderDialog();
    document.exitPointerLock?.();
    $('match-settings').showModal();
    (this.state?.canChange ? $('match-difficulty') : $('settings-resume')).focus();
  }

  close(resume = true) {
    if (!this.open) return;
    $('match-settings').close();
    if (resume) this.onResume();
  }

  error(message) {
    this.pending = null;
    this.lastError = message || 'Could not change bot difficulty.';
    this.renderDialog();
    $('difficulty-feedback').textContent = this.lastError;
  }

  disconnect() {
    this.close(false); this.state = null; this.pending = null; this.lastError = '';
    $('difficulty').disabled = true;
    $('difficulty-note').textContent = 'Connecting to the match…';
    $('bot-settings-button').textContent = 'Bots · F2';
  }
}
