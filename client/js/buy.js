// The shop is driven by the same weapon metadata and inventory as the server.
const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
const money = value => `$${Number(value || 0).toLocaleString('en-US')}`;
const GEAR = [
  {id:'vest', name:'Kevlar Vest', price:650},
  {id:'vesthelm', name:'Vest + Helmet', price:1000},
  {id:'kit', name:'Defuse Kit', price:200, team:2},
];
const CATEGORIES = [
  {name:'Pistols', classes:[1], hint:'Sidearms & akimbo', example:'mammoth'},
  {name:'SMGs', classes:[3], hint:'Speed & close quarters', example:'lynx'},
  {name:'Rifles', classes:[4,5], hint:'Assault & precision', example:'longbow'},
  {name:'Heavy', classes:[2,6], hint:'Shotguns & machine guns', example:'anvil'},
  {name:'Grenades', classes:[7,8,9], hint:'Clear, blind & conceal', example:'frag'},
  {name:'Equipment', classes:[], hint:'Protection, optics & utility', example:'vesthelm'},
];
const TYPE = ['', 'SIDEARM', 'SHOTGUN', 'SUBMACHINE GUN', 'ASSAULT RIFLE', 'SNIPER RIFLE', 'MACHINE GUN', 'EXPLOSIVE', 'FLASH GRENADE', 'SMOKE GRENADE'];
const INFO = {
  vest:'Restores armor to 100. Reduces damage to your body; your head remains unprotected.',
  vesthelm:'Restores armor to 100 and adds head protection. A helmet upgrade costs $350 with full armor.',
  kit:'Cuts defusing from 10 seconds to 5. Only available to defenders.',
  frag:'Flush opponents out of cover with an explosive grenade. Carry one at a time.',
  flash:'Blind opponents before you push. Carry up to two flashbangs.',
  smoke:'Block a sightline with a smoke cloud. Carry one at a time.',
  twin_mp7:'Hold left mouse to fire the left MP7, right mouse for the right, or both for automatic fire. No aiming mode.',
  twin_lever:'Click left mouse for the left shotgun; right mouse for the right. Each hand cycles its lever between shots. No aiming mode.',
  red_dot:'A reflex sight for compatible single weapons, including pistols. Optics stay attached when the gun is dropped.',
  acog:'A magnified scope for compatible single shotguns, SMGs, rifles and machine guns. Pistols cannot use it.',
  titan:'Heavy bolt-action with a fixed 12× scope. Lethal headshots; body hits deal 110 damage within 20 m and 94 from 50 m, even through armor.',
  kar98k:'Affordable bolt-action precision for long-range shots. Iron sights by default; accepts Red Dot or ACOG from Equipment.',
};

// Original lightweight illustrations: no image downloads or extra WebGL contexts.
function artwork(item) {
  if (!item) return '';
  let shape = '';
  if (item.id === 'vest' || item.id === 'vesthelm') {
    shape = '<path d="M85 19 66 29 61 100 108 107 155 100 150 29 131 19 124 35 94 35Z"/><path class="bu-etch" d="M79 45H139M78 61H140M76 77H142M109 37V99M89 20V34M128 20V34"/>';
    if (item.id === 'vesthelm') shape += '<path d="M157 37Q157 10 181 10Q209 10 210 39L201 45H185L183 57 168 52 167 39Z"/><path class="bu-etch" d="M164 35H208M185 45V54"/>';
  } else if (item.id === 'kit') {
    shape = '<path d="M73 35H168L177 45V98H64V45ZM91 34V23H150V34H140V30H101V34Z"/><path class="bu-etch" d="M65 58H176M83 48V70M158 48V70M104 77H136M120 64V90"/>';
  } else if (item.id === 'red_dot') {
    shape = '<path d="M68 79H174V92H68ZM82 70H161V81H82ZM83 29Q111 14 147 31L158 70H79Z"/><path d="M92 36Q111 27 139 37L145 62H89Z" fill="#263743"/><path class="bu-etch" d="M76 86H166M95 74H150"/><circle cx="117" cy="48" r="4" fill="#e46e58"/><path d="M157 51H174V64H157Z"/>';
  } else if (item.id === 'acog') {
    shape = '<path d="M55 43H90V70H55ZM88 37H145V75H88ZM142 31H179L190 40V76L178 84H143ZM96 72H108V88H96ZM145 77H157V88H145ZM86 87H168V96H86ZM107 28H127V39H107ZM107 22H126V30H107Z"/><path d="M181 42H189V73H181Z" fill="#658b9c"/><path class="bu-etch" d="M63 49V63M70 49V63M77 49V63M96 45H135M155 38V77M96 92H159"/>';
  } else if (item.cls >= 7) {
    if (item.cls === 7) shape = '<path d="M107 39 97 51 91 76 98 99 117 108 138 99 147 76 140 51 129 39ZM110 21H127V40H110Z"/><path class="bu-etch" d="M106 52H133M98 69H142M98 87H141M113 45V101M127 45V101"/>';
    else shape = '<path d="M101 37H138L143 44V99L136 106H104L97 99V44ZM108 21H132V37H108Z"/><path class="bu-etch" d="M98 53H142M98 88H142M109 62H131M109 72H131"/>';
    shape += '<path d="M128 22H147L154 67H147L139 31H128Z"/><circle class="bu-etch" cx="99" cy="24" r="9"/>';
  } else if (item.id === 'twin_mp7') {
    // Compact receivers, magazines in the grips, folding foregrips and wire stocks.
    const mp7 = '<path d="M64 35H164V59H124L116 65H109L106 95H86L89 62H66ZM163 40H188V49H163ZM143 58H155L153 79H144Z"/><path d="M26 40H67V46H34V59H27ZM68 29H161V35H68ZM76 24H84V31H76ZM148 23H157V31H148Z"/><path d="M110 62V76H127L134 59H128L123 70H117V62Z"/><path class="bu-etch" d="M74 43H154M137 49V56M144 49V56M151 49V56M94 70 92 88M28 53H65"/>';
    shape = `<g transform="translate(-15,-6) scale(.84)">${mp7}</g><g transform="translate(66,24) scale(.79)">${mp7}</g>`;
  } else if (item.id === 'twin_lever') {
    // M1887-inspired rounded actions, cut-down bird's-head stocks and large loops.
    const lever = '<path d="M79 37Q67 37 62 47L62 58Q65 68 83 68H113Q124 65 124 54V44L114 38ZM64 49 51 55Q46 64 33 71Q29 80 42 87Q51 92 60 84L77 66Z"/><path d="M119 42H204V50H119ZM121 53H191V60H121ZM131 50H166Q172 55 166 64H129ZM194 37H201V43H194ZM76 31 84 35V40H75Z"/><path d="M82 65C69 75 77 92 92 90Q108 88 122 69L117 64" fill="none" stroke="currentColor" stroke-width="6"/><path d="M95 65 92 76 99 79 102 75 98 73 101 65Z"/><path class="bu-etch" d="M76 44Q91 40 113 45M72 56Q85 61 112 59M139 53V61M148 53V61M157 53V61M41 78 60 64"/><circle cx="112" cy="53" r="3" fill="#25323d"/>';
    shape = `<g transform="translate(-17,-6) scale(.83)">${lever}</g><g transform="translate(62,28) scale(.78)">${lever}</g>`;
  } else if (item.id === 'titan') {
    shape = '<path d="M10 53 39 46H62V42H155V61H112L103 72H90L82 94H69L76 63H57L29 80H10ZM121 61H144V82H122ZM155 48H218V56H155ZM216 43H234V61H216Z"/><path d="M70 24H86V43H70ZM84 27H132V40H84ZM130 21H158V46H130ZM91 40H98V45H91ZM121 39H128V45H121ZM105 20H119V28H105ZM174 56 158 92H164L180 61 194 92H201L184 56Z"/><path d="M107 54 110 65 119 66" fill="none" stroke="currentColor" stroke-width="5"/><path class="bu-etch" d="M20 59 48 53M69 49H97M130 66V77M137 66V77M143 26V41M222 46V58M228 46V58"/>';
  } else if (item.id === 'kar98k') {
    // Slender unscoped sporting profile: continuous wood stock and bent bolt handle.
    shape = '<path d="M11 61 39 55 61 62 79 57H177V66H91L77 72 63 69 43 87H12Z" fill="#a77c50"/><path d="M73 49H117V59H73ZM115 50H230V55H115ZM104 43H113V51H104ZM217 43H223V51H217ZM169 50H175V67H169ZM8 61H13V88H8Z"/><path d="M95 57 103 66 109 66" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="111" cy="67" r="5"/><path d="M80 69V77Q89 87 100 75V67M89 66 86 75" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 66 38 62 53 67M21 79 39 72M120 61H162" fill="none" stroke="#715235" stroke-width="2"/><path class="bu-etch" d="M78 54H99M179 53H211"/>';
  } else if (item.cls === 1) {
    const heavy = item.id.includes('mammoth');
    const pistol = `<path d="M53 39H${heavy ? 188 : 177}V55H139L132 66H105L99 101H73L83 58H53ZM110 58V71H127L134 57H127L122 66H117V58Z"/><path class="bu-etch" d="M61 48H163M89 65 82 92M151 41V53M158 41V53M165 41V53"/><path d="M64 35H71V40H64M155 35H164V40H155"/>`;
    shape = item.dual ? `<g transform="translate(-14,-8) scale(.83)">${pistol}</g><g transform="translate(66,20) scale(.8)">${pistol}</g>` : pistol;
  } else {
    const sniper = item.cls === 5, smg = item.cls === 3, heavy = item.cls === 6, shotgun = item.cls === 2;
    const curved = ['rook','jackal','sabre','wasp'].includes(item.id);
    shape = `<path d="M16 53 50 48 57 42H${smg ? 146 : 162}V58H122L115 72H92L85 94H72L80 62H53L25 77H16ZM99 61V73H110L117 61H112L107 68H105V61Z"/><path d="M${smg ? 143 : 158} 46H${sniper ? 223 : 205}V53H${smg ? 143 : 158}Z"/>`;
    if (heavy) shape += '<path d="M118 60H151L159 89H123Z"/><path class="bu-etch" d="M129 65V83M140 65V83"/>';
    else if (!shotgun) shape += curved ? '<path d="M123 59H139Q138 80 152 94L137 102Q119 84 123 59Z"/>' : '<path d="M119 59H138L134 91H119Z"/>';
    if (sniper) shape += '<path d="M85 24H133V37H85ZM78 22H89V39H78ZM131 22H145V39H131ZM99 36H105V43H99ZM123 36H129V43H123Z"/>';
    else shape += '<path d="M71 37H79V44H71M148 35H154V44H148"/>';
    if (shotgun) shape += '<path d="M125 56H182V65H125Z"/><path class="bu-etch" d="M134 57V64M141 57V64M148 57V64M155 57V64M162 57V64M169 57V64"/>';
    shape += '<path class="bu-etch" d="M57 50H114M129 49H150M27 58 45 54M91 47V55"/>';
    if (item.id === 'cricket') shape += '<path d="M188 43H224V56H188Z"/>';
  }
  return `<svg class="bu-art" viewBox="0 0 240 120" aria-hidden="true"><g fill="currentColor" stroke-linejoin="round">${shape}</g></svg>`;
}

export class BuyMenu {
  constructor(element, onBuy, onClose) {
    this.el = element; this.onBuy = onBuy; this.onClose = onClose;
    this.open = false; this.category = -1; this.weapons = []; this.optics = []; this.team = 1;
    this.me = {mo:0, ar:0, he:false, pr:-1, se:-1, nd:[0,0,0], cb:false};
    this.selected = 'vest'; this.cache = ''; this.notice = ''; this.pending = null;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Buy menu');
    this.el.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !this.el.contains(button)) return;
      if (button.dataset.cat !== undefined) this.chooseCategory(Number(button.dataset.cat));
      else if (button.dataset.item) this.purchase(button.dataset.item);
      else if (button.dataset.action === 'purchase') this.purchase(this.selected);
      else if (button.dataset.action === 'close') this.close();
      else if (button.dataset.action === 'back') this.key(0);
    });
    const inspect = event => {
      const card = event.target.closest('[data-item]');
      if (card && card.dataset.item !== this.selected) {
        this.selected = card.dataset.item;
        this.el.querySelectorAll('.bu-card').forEach(el => el.classList.toggle('bu-selected', el.dataset.item === this.selected));
        this.renderDetail();
      }
    };
    this.el.addEventListener('mouseover', inspect);
    this.el.addEventListener('focusin', inspect);
  }

  init(weapons, optics = []) { this.weapons = weapons; this.optics = optics.map(optic => ({...optic, attachment:true})); this.cache = ''; }
  item(id) { return this.weapons.find(w => w.id === id) || GEAR.find(w => w.id === id) || this.optics.find(optic => optic.id === id); }
  items(category, team = this.team) {
    const cat = CATEGORIES[category];
    if (!cat) return [];
    return (category === 5 ? GEAR.concat(this.optics) : this.weapons.filter(w => cat.classes.includes(w.cls)))
      .filter(w => !w.team || w.team === team);
  }
  inventoryKey(me = this.me) { return [me.mo, me.ar, +me.he, +me.kit, me.pr, me.se, me.w, me.optic, me.prOptic, me.seOptic, me.zoom, ...(me.nd || [0,0,0]), +me.cb].join('|'); }
  state(item) {
    const me = this.me, idx = this.weapons.indexOf(item);
    const price = item.id === 'vesthelm' && me.ar >= 100 && !me.he ? 350 : item.price;
    const target = item.attachment ? this.weapons[me.w] : null;
    const compatible = !item.attachment || !!target?.optics?.includes(item.index);
    const mounted = item.attachment ? this.optics.find(optic => optic.index === me.optic) : null;
    let owned = false, stock = '';
    if (item.attachment) owned = compatible && me.optic === item.index;
    else if (item.id === 'vest') owned = me.ar >= 100;
    else if (item.id === 'vesthelm') owned = me.ar >= 100 && me.he;
    else if (item.id === 'kit') owned = !!me.kit;
    else if (item.cls >= 7 && item.cls <= 9) {
      const count = (me.nd || [0,0,0])[item.cls - 7], max = item.cls === 8 ? 2 : 1;
      owned = count >= max; stock = `${count} / ${max} carried`;
    } else owned = idx >= 0 && (me.pr === idx || me.se === idx);
    const affordable = me.mo >= price;
    const status = owned ? (stock ? 'MAX STOCK' : 'OWNED') : !compatible ? (target?.mag ? 'INCOMPATIBLE' : 'EQUIP A COMPATIBLE GUN') : !me.cb ? 'BUYING CLOSED' : !affordable ? `NEED ${money(price - me.mo)}` : stock || 'AVAILABLE';
    return {price, owned, affordable, stock, status, target, compatible, mounted, disabled: owned || !compatible || !affordable || !me.cb || !!this.pending};
  }
  toggle(open) {
    this.open = open; this.cache = '';
    this.el.classList.toggle('hidden', !open);
    if (open) {
      this.category = -1; this.notice = '';
      this.selected = this.me.ar < 100 ? 'vest' : 'vesthelm';
      this.render(this.me, this.team, this.context);
    } else if (this.el.contains(document.activeElement)) document.activeElement.blur();
  }
  close() { this.toggle(false); this.onClose?.(); }
  chooseCategory(category) {
    this.category = category; this.notice = ''; this.cache = '';
    const items = this.items(category);
    if (category >= 0 && !items.some(w => w.id === this.selected)) this.selected = (items.find(w => !this.state(w).disabled) || items[0])?.id;
    this.render(this.me, this.team, this.context);
  }
  key(n) {
    if (!this.open) return false;
    if (n === 0) { if (this.category < 0) this.close(); else this.chooseCategory(-1); }
    else if (this.category < 0) { if (n >= 1 && n <= CATEGORIES.length) this.chooseCategory(n - 1); }
    else { const item = this.items(this.category)[n - 1]; if (item) { this.selected = item.id; this.purchase(item.id); } }
    return true;
  }
  purchase(id) {
    const item = this.item(id);
    if (!item) return;
    const state = this.state(item);
    if (state.disabled) {
      this.notice = this.pending ? 'Purchase pending…' : state.status;
      this.cache = ''; this.render(this.me, this.team, this.context); return;
    }
    this.pending = {id, name:item.name, before:this.inventoryKey(), money:this.me.mo, at:performance.now()};
    this.notice = `Purchasing ${item.name}…`; this.cache = '';
    this.onBuy(id);
    this.render(this.me, this.team, this.context);
  }

  render(me, team, context = {}) {
    this.me = me; this.team = team; this.context = context || {};
    if (this.pending && (this.inventoryKey() !== this.pending.before || performance.now() - this.pending.at > 1500)) {
      this.notice = me.mo < this.pending.money ? `${this.pending.name} purchased` : 'Purchase unavailable. Check your budget and buy zone.';
      this.pending = null; this.cache = '';
    }
    this.el.classList.toggle('hidden', !this.open);
    if (!this.open) return;
    const seconds = Number.isFinite(this.context.buySeconds) ? Math.max(0, Math.ceil(this.context.buySeconds)) : null;
    const timerText = seconds !== null ? `${seconds}s remaining` : me.cb ? 'Buying available' : '';
    const cache = `${this.category}|${team}|${this.inventoryKey()}|${!!this.pending}`;
    if (cache === this.cache) {
      // Countdown ticks must not replace focused/hovered purchase buttons.
      if (timerText !== this.timerText) {
        this.timerElement.textContent = timerText;
        this.timerText = timerText;
      }
      return;
    }
    this.cache = cache;
    const focused = document.activeElement?.closest('#buy button');
    const focusKey = focused?.dataset.item ? `[data-item="${focused.dataset.item}"]` : focused?.dataset.cat !== undefined ? `[data-cat="${focused.dataset.cat}"]` : focused?.dataset.action ? `[data-action="${focused.dataset.action}"]` : null;
    this.el.dataset.team = team;
    this.el.innerHTML = `<header class="bu-header"><div><div class="bu-eyebrow">${team === 2 ? 'DEFENDERS' : 'ATTACKERS'} · ROUND SUPPLY</div><h2>BUY MENU</h2></div><div class="bu-budget"><span>AVAILABLE FUNDS</span><strong>${money(me.mo)}</strong></div><button class="bu-close" data-action="close" aria-label="Close buy menu">×</button></header>
      <nav class="bu-tabs" aria-label="Buy categories">${CATEGORIES.map((cat, i) => `<button data-cat="${i}" class="${this.category === i ? 'bu-active' : ''}" aria-pressed="${this.category === i}"><kbd>${i + 1}</kbd>${cat.name}</button>`).join('')}</nav>
      <div class="bu-body"><section class="bu-shop"><div class="bu-section-heading"><div><h3>${this.category < 0 ? 'Build your loadout' : CATEGORIES[this.category].name}</h3><p>${this.category < 0 ? 'Choose a category to browse your arsenal.' : CATEGORIES[this.category].hint + ' · click an item to purchase'}</p></div>${this.category >= 0 ? '<button class="bu-back" data-action="back"><kbd>0</kbd> Categories</button>' : ''}</div><div class="bu-grid ${this.category < 0 ? 'bu-category-grid' : this.items(this.category).length > 6 ? 'bu-many-items' : ''}">${this.category < 0 ? this.categoryCards() : this.items(this.category).map((item, i) => this.card(item, i)).join('')}</div></section><aside class="bu-detail" aria-label="Item details"></aside></div>
      <div class="bu-loadout"><span class="bu-loadout-label">YOUR LOADOUT</span>${this.loadout()}</div>
      <footer class="bu-footer"><span class="bu-zone ${me.cb ? 'bu-zone-open' : ''}"><i></i>${me.cb ? 'IN BUY ZONE' : 'BUYING CLOSED'}<span class="bu-time">${timerText}</span></span><span class="bu-notice" role="status">${esc(this.notice)}</span><span class="bu-shortcuts"><kbd>${this.category < 0 ? '1–6' : '1–' + this.items(this.category).length}</kbd> ${this.category < 0 ? 'category' : 'buy'} <kbd>0</kbd> ${this.category < 0 ? 'close' : 'back'} <kbd>B</kbd> close</span></footer>`;
    this.timerElement = this.el.querySelector('.bu-time'); this.timerText = timerText;
    this.renderDetail();
    if (focusKey) this.el.querySelector(focusKey)?.focus({preventScroll:true});
  }
  categoryCards() {
    return CATEGORIES.map((cat, i) => {
      const items = this.items(i), min = Math.min(...items.map(w => this.state(w).price));
      return `<button class="bu-category" data-cat="${i}"><div class="bu-card-top"><kbd>${i + 1}</kbd><span>${items.length} OPTIONS</span></div>${artwork(this.item(cat.example))}<strong>${cat.name}</strong><span class="bu-category-hint">${cat.hint}</span><span class="bu-category-price">FROM ${money(min)} <b>→</b></span></button>`;
    }).join('');
  }
  card(item, i) {
    const state = this.state(item);
    return `<button class="bu-card ${this.selected === item.id ? 'bu-selected' : ''} ${state.owned ? 'bu-owned' : ''} ${!state.affordable ? 'bu-unaffordable' : ''}" data-item="${item.id}" aria-disabled="${state.disabled}" aria-label="${esc(item.name)}, ${money(state.price)}, ${esc(state.status)}"><div class="bu-card-top"><kbd>${i + 1}</kbd><span class="bu-card-price">${money(state.price)}</span></div>${artwork(item)}<strong>${esc(item.name)}</strong><span class="bu-card-status">${state.owned ? '✓ ' : ''}${esc(state.status)}${item.dual && !state.owned ? ' · AKIMBO' : ''}</span></button>`;
  }
  renderDetail() {
    const panel = this.el.querySelector('.bu-detail'), item = this.item(this.selected);
    if (!panel || !item) return;
    const state = this.state(item), gun = item.mag > 0;
    const desc = INFO[item.id] || (item.dual ? 'Independent triggers: left mouse fires the left weapon; right mouse fires the right. No aiming mode.' : item.cls === 5 ? 'Precision at range. Right mouse aims through the scope. Settle your movement before taking the shot.' : item.cls === 2 ? 'Built for close quarters. Damage is shown per pellet; your spread is most effective up close.' : item.cls === 6 ? 'Sustained fire and a deep magazine. Control your bursts and plan around the longer reload.' : item.auto ? 'Automatic fire. Right mouse aims down sights. Short bursts help control recoil at range.' : 'A reliable sidearm. Click to fire and hold right mouse to aim down sights.');
    const type = item.attachment ? 'WEAPON OPTIC' : item.id === 'titan' ? 'HEAVY BOLT-ACTION RIFLE' : item.boltAction ? 'BOLT-ACTION RIFLE' : TYPE[item.cls] || 'TACTICAL EQUIPMENT';
    const stat = (name, value, ratio) => `<div class="bu-stat"><div><span>${name}</span><b>${value}</b></div><div class="bu-meter"><i style="width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%"></i></div></div>`;
    const stats = item.attachment ? `<div class="bu-gear-benefit bu-optic-benefit"><span>MAGNIFICATION</span><strong>${item.zoom}×</strong><small>Mount target: ${esc(state.target?.mag ? state.target.name : 'No firearm equipped')}<br>Currently fitted: ${esc(state.mounted?.name || 'No purchased optic')}</small></div>` : gun
      ? stat(item.cls === 2 ? 'Damage / pellet' : 'Base damage', item.dmg, item.dmg / 115)
        + (item.boltAction ? stat('Bolt cycle', `${item.interval.toFixed(1)} s`, 1 - item.interval / 3) : stat(item.dual ? 'Rate / hand' : 'Fire rate', `${Math.round(60 / item.interval)} RPM`, (60 / item.interval) / 900))
        + stat(item.cls === 2 ? 'Shell capacity' : 'Magazine', item.dual ? `${item.mag / 2} + ${item.mag / 2}` : `${item.mag} ${item.cls === 2 ? 'shells' : 'rounds'}`, item.mag / 100)
        + stat('Reload time', `${item.reload.toFixed(1)} s`, 1 - item.reload / 6)
      : `<div class="bu-gear-benefit"><span>${item.id === 'kit' ? 'DEFUSE TIME' : item.cls >= 7 ? 'CARRY CAPACITY' : 'BODY ARMOR'}</span><strong>${item.id === 'kit' ? '5 seconds' : item.cls >= 7 ? (item.cls === 8 ? '2 flashbangs' : '1 grenade') : '100 points'}</strong>${item.id === 'vesthelm' ? '<small>Includes helmet protection</small>' : ''}</div>`;
    const replacement = gun ? this.weapons[item.cls === 1 ? this.me.se : this.me.pr] : null;
    let note = state.owned ? (state.stock ? 'You are carrying the maximum amount.' : 'Already in your loadout.') : replacement ? `Replaces ${replacement.name}. Your old weapon is dropped.` : state.price > this.me.mo ? `${money(state.price - this.me.mo)} more required.` : `Balance after purchase: ${money(this.me.mo - state.price)}`;
    if (item.attachment) {
      note = !state.compatible ? (state.target?.mag ? `${state.target.name} does not support ${item.name}. Close the menu and equip a compatible gun.` : 'Close the menu and equip a compatible gun, then reopen Equipment.')
        : state.owned ? `Mounted on ${state.target.name}.`
        : state.mounted ? `Replaces ${state.mounted.name} for ${money(state.price)}. No refund for the old optic.`
        : `Mounts on ${state.target.name} for ${money(state.price)}. Stays with this gun when dropped.`;
    }
    const action = this.pending ? 'PURCHASING…' : state.owned ? state.status : !state.compatible ? (state.target?.mag ? 'INCOMPATIBLE' : 'EQUIP A GUN') : !state.affordable ? 'INSUFFICIENT FUNDS' : !this.me.cb ? 'BUYING CLOSED' : item.attachment ? 'MOUNT OPTIC' : 'PURCHASE';
    panel.innerHTML = `<div class="bu-detail-kicker">${item.dual ? `AKIMBO ${type}S` : type}</div><div class="bu-detail-art">${artwork(item)}</div><h3>${esc(item.name)}</h3><p class="bu-description">${esc(desc)}</p><div class="bu-stats">${stats}</div><div class="bu-purchase-area"><button class="bu-purchase" data-action="purchase" ${state.disabled ? 'disabled' : ''}><span>${action}</span><strong>${money(state.price)}</strong></button><p class="bu-purchase-note">${esc(note)}</p></div>`;
  }
  loadout() {
    const me = this.me;
    const cell = (label, value, item, owned = true) => `<div class="bu-loadout-item ${owned ? '' : 'bu-empty'}" title="${esc(label + ': ' + value)}">${artwork(item)}<span><small>${esc(label)}</small><b>${esc(value)}</b></span></div>`;
    const attachmentLabel = index => { const optic = this.optics.find(o => o.index === index); return optic ? ` · ${optic.name.toUpperCase()}` : ''; };
    return cell('PRIMARY' + attachmentLabel(me.prOptic), this.weapons[me.pr]?.name || 'Empty slot', this.weapons[me.pr], me.pr >= 0)
      + cell('SIDEARM' + attachmentLabel(me.seOptic), this.weapons[me.se]?.name || 'Empty slot', this.weapons[me.se], me.se >= 0)
      + cell('PROTECTION', `${me.ar || 0} armor${me.he ? ' + helmet' : ''}`, GEAR[me.he ? 1 : 0], me.ar > 0)
      + cell('UTILITY', `${(me.nd || []).reduce((a,b) => a+b, 0)} grenades${me.kit ? ' · kit' : ''}`, me.kit ? GEAR[2] : this.item('frag'), (me.nd || []).some(n => n > 0) || me.kit);
  }
}
