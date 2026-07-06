// Commentary booth. The template engine IS the product: a large slot-filled
// line bank per persona, driven by match-loop event taps, with an xG-style
// chance read and a rolling match summary so lines sound aware. Speech is
// browser speechSynthesis + a bottom ticker (the ticker always works); the
// crowd bus ducks while the commentator talks. Everything degrades:
// model → templates → ticker captions, never an error. The pure helpers up
// top are DOM-free so tools can unit-test them in node.

const RECENT_MAX = 12;

// 3b: the one allowed dependency — an in-browser model runtime, dynamically
// imported inside a worker only after the user engages a commentary mode and
// a WebGPU probe passes. 0.5B instruct: color is ambient filler; smaller ≈
// a third of the download and per-line latency of the 1.5B.
const LLM_CDN = 'https://esm.run/@mlc-ai/web-llm';
const LLM_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const LLM_PERSONA = {
  bbc: 'You are Gary, a measured British football co-commentator. Understated, warm, precise. British English.',
  hype: 'You are Rafa, an excitable Latin football co-commentator. Energetic Spanglish — mostly English with Spanish exclamations.',
  dry: 'You are Stan, a deadpan American soccer analyst. Dry wit, short sentences, mildly unimpressed.',
};

// --- chance quality ------------------------------------------------------------
// Cheap xG from what the shot logic already knows: distance, angle, blockers.
export function xgFor(dist, absZ, blockers = 0) {
  const angle = 1 / (1 + (absZ / Math.max(4, dist)) * 2.2);
  const v = 0.95 * Math.exp(-dist / 11.5) * angle - blockers * 0.055;
  return Math.min(0.9, Math.max(0.02, v));
}

// --- personas -------------------------------------------------------------------
// duo: [play-by-play, analyst] — the analyst register lands in 3d/model color.
// voice.pbp / voice.ana = ordered preferred voice-name fragments (matched
// against speechSynthesis.getVoices() by name, case-insensitive), lang is the
// fallback family. `same: true` = one voice for the whole booth (HYPE).
export const PERSONAS = {
  bbc: {
    // Peter (play-by-play) & Gary (analyst): two distinct British male voices.
    label: 'BBC', duo: ['Peter', 'Gary'], langs: ['en-GB'],
    rate: 1.02, pitch: 1.0, anaRate: 0.96, anaPitch: 0.9,
    voice: {
      pbp: ['Daniel', 'Google UK English Male', 'Arthur', 'Oliver'],
      ana: ['Arthur', 'Oliver', 'Google UK English Male', 'Daniel'],
    },
  },
  hype: {
    // one extremely expressive, excited Latino man — same voice both mics.
    label: 'HYPE', duo: ['Andrés', 'Rafa'], langs: ['es-MX', 'es-US', 'es-ES', 'es-AR', 'es'],
    rate: 1.12, pitch: 1.06, anaRate: 1.04, anaPitch: 0.95, same: true,
    voice: {
      pbp: ['Juan', 'Diego', 'Jorge', 'Carlos', 'Google español de Estados Unidos', 'Google español', 'Paulina', 'Monica', 'Mónica'],
      ana: ['Juan', 'Diego', 'Jorge', 'Carlos', 'Google español de Estados Unidos', 'Google español', 'Paulina', 'Monica', 'Mónica'],
    },
  },
  dry: {
    // Chuck & Stan: two different chill/deadpan American male voices.
    label: 'DRY', duo: ['Chuck', 'Stan'], langs: ['en-US'],
    rate: 0.96, pitch: 0.92, anaRate: 0.92, anaPitch: 0.85,
    voice: {
      pbp: ['Alex', 'Aaron', 'Google US English', 'Fred'],
      ana: ['Fred', 'Reed', 'Junior', 'Aaron', 'Google US English'],
    },
  },
};

// --- template bank ---------------------------------------------------------------
// {player} {team} {opp} {score} {min} {dist} {chain} {keeper} get slot-filled.
// Suffix _w = worldie (low-xG/long-range), _t = tap-in (high-xG).
const BANK = {
  bbc: {
    kickoff: [
      'And we are under way — {team} against {opp}.',
      'The referee gets us started. {team} in possession first.',
      'Off we go, then. Lovely conditions for it.',
    ],
    goal: [
      'GOAL! {player} finishes it off, and it\'s {score}.',
      'It\'s in! {player} with the decisive touch. {score}.',
      'GOAL for {team}! {player} applies the finish.',
      'That\'s a goal — {player} keeps his composure. {score}.',
    ],
    goal_w: [
      'OH, THAT IS MAGNIFICENT! {player} from {dist} metres!',
      'GOAL OF THE SEASON CONTENDER! {player}, simply glorious!',
      'From nowhere! {player} has produced something special. {score}.',
    ],
    goal_t: [
      'And that is the simplest finish {player} will ever have. {score}.',
      'Gift-wrapped for {player}. He couldn\'t miss. {score}.',
    ],
    og: [
      'Oh dear — it\'s an own goal. Cruel on {player}.',
      'And that\'s gone in off {player}. These things happen.',
    ],
    save: [
      'Fine save! {keeper} equal to it.',
      '{keeper} gets down well. Good stop.',
      'Kept out! {keeper} was alert to the danger.',
    ],
    save_big: [
      'REMARKABLE save from {keeper}! How has he kept that out?',
      'That is a world-class stop from {keeper}!',
    ],
    nearMiss: [
      'Inches away! {player} so nearly had it.',
      'Just wide! {player} will wonder how that stayed out.',
      'Oh, so close from {player}. The keeper was beaten.',
    ],
    woodwork: [
      'OFF THE WOODWORK! {player} denied by the frame of the goal!',
      'The post comes to the rescue! {player} left holding his head.',
    ],
    foul: [
      'And the whistle goes — free kick against {player}.',
      'That\'s a foul. The referee has a word.',
    ],
    penalty: [
      'PENALTY! The referee points to the spot!',
      'It\'s a penalty to {team}! Huge moment.',
    ],
    corner: ['Corner to {team}. Bodies forward.', 'Behind for a corner — chance to load the box.'],
    freekick: ['Free kick in a promising spot for {team}.', 'Dangerous territory, this free kick.'],
    half: ['That\'s half-time. Time for a breather and a rethink.', 'The whistle goes for the interval. {score}.'],
    full: ['And there\'s the full-time whistle. It finishes {score}.', 'That\'s that — all over. {score} the final score.'],
    golden: ['Golden goal! Next score wins it — extraordinary tension.'],
    chain: [
      'Lovely stuff from {team} — {chain} passes and counting.',
      '{team} knitting it together nicely here.',
      'Patient, purposeful passing from {team}.',
    ],
    dominance: [
      '{team} are bossing this spell.',
      'It\'s all {team} at the moment; {opp} can\'t get out.',
    ],
    dribble: ['{player} is enjoying himself — past one, past two...', '{player} on a wander. He\'s tricky, this one.'],
    intent_commit: ['{team} have thrown caution to the wind now.', 'Everyone forward for {team} — they\'ve committed.'],
    intent_bunker: ['{team} are shutting up shop, everybody behind the ball.', '{team} quite happy to sit deep and see this out.'],
    intent_counterpress: ['{team} hunting the ball back immediately — a proper counter-press.'],
    levelLate: ['All square late on. Somebody blink.', 'Still level — this one\'s going to the wire.'],
    blowout: ['This has become very comfortable indeed for {team}.', 'One-way traffic. {opp} just want the whistle.'],
    cagey: ['A cagey affair so far — chances at a premium.', 'Both sides feeling each other out here.'],
    filler: [
      'Wonderful atmosphere around the ground.',
      'The pitch looks immaculate today.',
      'You can hear the away support from here.',
    ],
    aside_goal: [
      'Look at the movement again — that\'s well worked, Peter.',
      'The defending will disappoint the coach, but you have to credit the finish.',
      'That\'s been coming, in truth. They\'ve carried the greater threat.',
    ],
    aside_save: [
      'Textbook positioning — he made that look easier than it was.',
      'Big keepers make big saves at big moments. Simple as that.',
    ],
    aside_miss: [
      'He\'ll want that one back. You must hit the target from there.',
      'Good chance, that. The coach will note it down.',
    ],
  },
  hype: {
    kickoff: [
      '¡ARRANCAMOS! {team} contra {opp} — vamos, vamos, VAMOS!',
      'Here we GO amigos! {team} y {opp}! Fútbol time!',
    ],
    goal: [
      '¡GOOOOOOL! ¡GOL GOL GOL! {player}! {score}!',
      '¡GOLAZO de {player}! The net is DANCING! {score}!',
      '¡SÍÍÍÍ! {player} does it for {team}! {score}!',
    ],
    goal_w: [
      '¡¡GOOOOOOOOOL!! ¡QUÉ BARBARIDAD! {player} from {dist} metres, INCREÍBLE!',
      '¡MAMMA MÍA! {player}! That is IMPOSSIBLE! ¡GOLAZO ETERNO!',
    ],
    goal_t: [
      '¡GOL! Easy easy easy for {player} — un regalo! {score}!',
    ],
    og: ['¡Ay no no NO! Own goal! Pobre {player}!', '¡En su propia puerta! Disaster for {player}!'],
    save: ['¡QUÉ ATAJADA! {keeper} says NO!', '¡{keeper}! Las manos de oro!'],
    save_big: ['¡¡ATAJADÓN!! {keeper} is a WALL, un MURO!', '¡NO PUEDE SER! {keeper} steals a certain goal!'],
    nearMiss: ['¡UYYYY! Casi casi CASI, {player}!', '¡Por un pelito! {player} almost breaks the net!'],
    woodwork: ['¡EL PALO! The post says no bueno, {player}!', '¡MADERA! So cruel, {player}!'],
    foul: ['¡Falta! The ref is not happy with {player}.', '¡Uy, qué patada! Free kick.'],
    penalty: ['¡PENAL! ¡PENAL PENAL PENAL! This is ENORME!', '¡El punto penal, señores! Drama total!'],
    corner: ['Córner for {team} — everybody to the pot, al área!'],
    freekick: ['Tiro libre peligroso for {team}! Cuidado!'],
    half: ['Medio tiempo! Take a breath amigos — {score}!'],
    full: ['¡Se acabó! FINAL! {score}! Qué partido, señores!'],
    golden: ['¡GOL DE ORO! Next goal WINS! Ay, my heart!'],
    chain: ['Tiki-taka from {team}! {chain} passes, qué bonito!', '{team} painting little pictures out there!'],
    dominance: ['¡Puro {team} right now! {opp} cannot breathe!'],
    dribble: ['¡Mira mira MIRA! {player} is dancing with the ball!'],
    intent_commit: ['{team} sends EVERYBODY! Total attack, a lo loco!'],
    intent_bunker: ['{team} parks el autobús! Everyone home!'],
    intent_counterpress: ['{team} hunting like lobos to win it back!'],
    levelLate: ['Still level! Ay ay ay, I cannot watch!'],
    blowout: ['This is a FIESTA for {team}!'],
    cagey: ['Mucho respeto between these two — nobody blinks.'],
    filler: ['Qué ambiente in this stadium tonight!', 'The fans are singing, señores — this is fútbol!'],
    aside_goal: [
      'Andrés, my heart! Watch the replay — pura magia, no defense in the world stops that!',
      'They practice this, eh? Beautiful movement, beautiful gol!',
    ],
    aside_save: [
      'You do not score past him tonight, amigo. NO tonight!',
      'Frame it! Put that save in a museum!',
    ],
    aside_miss: [
      '¡Increíble que no entró! The goal was BEGGING for it!',
      'He will dream of that one, te lo juro.',
    ],
  },
  dry: {
    kickoff: [
      'We\'re off. {team}, {opp}, one ball between them.',
      'Kickoff. Both teams contractually obligated to be here.',
    ],
    goal: [
      'Goal. {player}. The scoreboard now reads {score}.',
      'That\'s a goal for {player}. Somewhere, a defender is filing a complaint.',
      '{player} scores. The net did its job. {score}.',
    ],
    goal_w: [
      'Well. {player} just scored from {dist} metres. That was not in the scouting report.',
      'From {dist} metres out. Sure, {player}. Why not.',
    ],
    goal_t: [
      '{player} scores from roughly one yard. Ice water in the veins.',
      'Open goal, {player}, tap-in. My grandmother buries that, but it counts.',
    ],
    og: ['Own goal. {player} with an inch-perfect finish into the wrong net.', 'That\'s an own goal for {player}. Bold strategy.'],
    save: ['Saved. {keeper} doing keeper things.', '{keeper} with the stop. That\'s literally the job.'],
    save_big: ['{keeper} just committed robbery on live television.', 'An outstanding save from {keeper}, who apparently woke up today.'],
    nearMiss: ['Wide. {player} nearly made this interesting.', 'Just past the post. {player} sends his regards.'],
    woodwork: ['Off the post. Physics remains undefeated, {player}.', 'The woodwork with the save of the match.'],
    foul: ['Foul. {player} went through the man. And the man\'s ancestors.', 'Whistle. That one gets a stern look.'],
    penalty: ['Penalty. Someone did something regrettable in the box.', 'Spot kick. Time to learn a lot about someone\'s nerves.'],
    corner: ['Corner. Tall people, report to the box.'],
    freekick: ['Free kick in shooting range. Wall assembly in progress.'],
    half: ['Half-time. {score}. I\'ve seen worse.', 'That\'s the half. Oranges for some, tactics for others.'],
    full: ['Full-time, {score}. We all learned something today, probably.', 'It\'s over. {score}. Set your expectations accordingly next week.'],
    golden: ['Golden goal. Sudden death, minus the paperwork.'],
    chain: ['{chain} consecutive passes from {team}. Somebody\'s been at training.', '{team} passing it around like it\'s rent day.'],
    dominance: ['{team} have decided this is their ball now.', '{opp} are chasing shadows, and losing that race too.'],
    dribble: ['{player} refuses to pass. Confidence, or hearing loss.', '{player} dribbling like the ball owes him money.'],
    intent_commit: ['{team} going full send. Defense is a rumor now.'],
    intent_bunker: ['{team} in maximum-turtle formation.'],
    intent_counterpress: ['{team} pressing like the ball is a lost phone.'],
    levelLate: ['Still tied this late. Cardiologists on standby.'],
    blowout: ['This one\'s decided. We\'re all just being polite now.'],
    cagey: ['Riveting stuff. Two teams, zero risk appetite.'],
    filler: ['The grass is green. The ball is round. We continue.', 'Lovely evening for standing around a lawn.'],
    aside_goal: [
      'Replay confirms it: the defense was elsewhere. Possibly getting snacks.',
      'Statistically, someone was going to score eventually. Here we are.',
      'Clean strike. The goalkeeper\'s commute just got longer.',
    ],
    aside_save: [
      'That save just earned someone a contract extension.',
      'The shooter did everything right except account for the goalkeeper.',
    ],
    aside_miss: [
      'The data says shoot from there. The data did not say shoot like that.',
      'That miss will feature in the team meeting. Prominently.',
    ],
  },
};

function fill(t, slots) {
  return t.replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? '');
}

// pick a template for (persona, type), avoiding recently-used lines and
// recently-used sentence openers so nothing repeats noticeably
export function pickLine(persona, type, slots, recent, openers) {
  const bank = BANK[persona]?.[type];
  if (!bank || !bank.length) return null;
  let pool = bank.filter((t) => !recent.includes(t));
  if (openers?.length) {
    const fresh = pool.filter((t) => !openers.includes(t.split(' ')[0]));
    if (fresh.length) pool = fresh;
  }
  if (!pool.length) pool = bank;
  const t = pool[(Math.random() * pool.length) | 0];
  recent.push(t);
  if (recent.length > RECENT_MAX) recent.shift();
  if (openers) {
    openers.push(t.split(' ')[0]);
    if (openers.length > 5) openers.shift();
  }
  return fill(t, slots);
}

// --- rolling match summary --------------------------------------------------------
export class MatchSummary {
  constructor() {
    this.momentum = 0;   // +1 = team A on top
    this.chain = 0;
    this.chainTeam = null;
    this.shots = { A: 0, B: 0 };
    this.epoch = 0;      // bumps on turnovers/goals — stale-line guard for the model
  }

  own(teamKey, passed) {
    if (passed && teamKey === this.chainTeam) this.chain++;
    else { this.chain = passed ? 1 : 0; if (teamKey !== this.chainTeam) this.epoch++; }
    this.chainTeam = teamKey;
    this.momentum += (teamKey === 'A' ? 1 : -1) * 0.06;
    this.momentum = Math.max(-1, Math.min(1, this.momentum * 0.995));
  }

  shot(teamKey) { this.shots[teamKey]++; this.momentum += (teamKey === 'A' ? 0.12 : -0.12); }

  // one compact line for model prompts
  text(match) {
    if (!match) return '';
    const m = match;
    return `${m.teamA.def.code} ${m.scoreA}-${m.scoreB} ${m.teamB.def.code}, ${m.clockText()}, `
      + `${this.momentum > 0.35 ? m.teamA.def.code : this.momentum < -0.35 ? m.teamB.def.code : 'neither side'} on top, `
      + `pass chain ${this.chain} (${this.chainTeam ?? '-'})`;
  }
}

// --- booth shell (browser only) -------------------------------------------------------

const MODES = ['off', 'bbc', 'hype', 'dry'];

export class Booth {
  constructor(audio) {
    this.audio = audio;
    this.mode = 'off';
    this.match = null;
    this.sum = new MatchSummary();
    this.recent = [];
    this.openers = [];
    this.colorT = 8;
    this.speaking = false;
    this.lastKeyAt = 0;
    this.lastShot = null;
    this.cool = new Map(); // per-type cooldowns
    this._voices = [];
    this.live = false;
    this.voiceOn = true; // spoken voice on/off; captions render regardless
  }

  initUI(btn, modeEl, ticker) {
    this.btn = btn;
    this.modeEl = modeEl;
    this.ticker = ticker;
    const saved = localStorage.getItem('pp-comm');
    if (MODES.includes(saved)) this.mode = saved;
    const savedVoice = localStorage.getItem('pp-voice');
    this.voiceOn = savedVoice === null ? true : savedVoice === '1';
    this._paintMode();
    btn.onclick = () => this.cycle();
    if (typeof speechSynthesis !== 'undefined') {
      this._voices = speechSynthesis.getVoices();
      speechSynthesis.addEventListener?.('voiceschanged', () => {
        this._voices = speechSynthesis.getVoices();
        this._voicesForMode = null; // recompute persona voices once real list lands
      });
      // TTS on Safari / locked-down Chrome only unlocks from a user gesture. The
      // mic button is one path, but the booth can also be persisted ON from a
      // previous session (no click). Prime on the FIRST interaction anywhere so
      // event-driven match calls actually produce audio.
      const unlock = () => this._prime();
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
        window.addEventListener(ev, unlock, { once: true, capture: true });
      }
    }
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    localStorage.setItem('pp-comm', this.mode);
    this._paintMode();
    this._stopSpeech();
    this._prime(); // this click is a user gesture — use it to unlock TTS
    if (this.mode === 'off') {
      this.audio.duckCrowd(1);
      this._hideTicker();
    } else {
      this.audio.duckCrowd(0.8);
      this._show(`${PERSONAS[this.mode].duo.join(' & ')} in the booth`, PERSONAS[this.mode].duo[0]);
      this._warmModel(); // 3b: deliberate engagement is the download gate
    }
  }

  _paintMode() {
    if (this.modeEl) this.modeEl.textContent = this.mode === 'off' ? 'OFF' : PERSONAS[this.mode].label;
    if (this.btn) this.btn.classList.toggle('on', this.mode !== 'off');
  }

  attach(match) {
    this.match = match;
    this.sum = new MatchSummary();
    this.recent = [];
    this.openers = [];
    this.colorT = 6 + Math.random() * 6;
    this.lastShot = null;
    this.cool.clear();
    if (this.mode !== 'off') this.audio.duckCrowd(0.8);
  }

  detach() {
    this.match = null;
    clearTimeout(this._asideT);
    this._stopSpeech();
    this._hideTicker();
    this.audio.duckCrowd(1);
  }

  // ---- event intake -------------------------------------------------------------

  evt(type, d = {}) {
    if (!this.match) return;
    const m = this.match;
    switch (type) {
      case 'own':
        this.sum.own(d.p.team.key, !!d.passed);
        return;
      case 'shot': {
        const xg = xgFor(d.dist, Math.abs(d.z ?? 0), d.blockers ?? 0);
        this.lastShot = { p: d.p, xg, dist: d.dist, at: performance.now() };
        this.sum.shot(d.p.team.key);
        return;
      }
      case 'goal': {
        this.sum.epoch++;
        const scorer = d.toucher ?? null;
        const ls = this.lastShot && performance.now() - this.lastShot.at < 4500 ? this.lastShot : null;
        const xg = ls?.xg ?? 0.3;
        const dist = Math.round(ls?.dist ?? 12);
        let sub = 'goal';
        if (d.og) sub = 'og';
        else if (xg < 0.13 || dist > 24) sub = 'goal_w';
        else if (xg > 0.45) sub = 'goal_t';
        this._key(sub, { player: scorer?.name ?? d.scorer.def.name, dist });
        return;
      }
      case 'save':
        this.sum.epoch++;
        if (this.lastShot && this.lastShot.xg > 0.34) this._key('save_big', { keeper: d.gk.name });
        else if (this.lastShot && (this.lastShot.xg > 0.16 || Math.random() < 0.4)) {
          this._key('save', { keeper: d.gk.name });
        }
        return;
      case 'nearMiss':
        this.sum.epoch++;
        this._key('nearMiss', { player: d.p?.name ?? '' });
        return;
      case 'woodwork':
        this.sum.epoch++;
        this._key('woodwork', { player: d.p?.name ?? '' });
        return;
      case 'foul':
        if (!d.pen && Math.random() < 0.45) return;
        this._key('foul', { player: d.fouler?.name ?? '' });
        return;
      case 'setpiece':
        this.sum.epoch++;
        if (d.kind === 'penalty') this._key('penalty', { team: d.team.def.name });
        else if (d.kind === 'corner' && this._cooled('corner', 24)) this._key('corner', { team: d.team.def.name });
        else if (d.kind === 'freekick' && d.att && this._cooled('freekick', 24)) this._key('freekick', { team: d.team.def.name });
        return;
      case 'kickoff':
        if (d.first) this._key('kickoff', {});
        return;
      case 'half': this._key('half', {}); return;
      case 'golden': this._key('golden', {}); return;
      case 'full': this._key('full', {}); return;
    }
  }

  _cooled(k, secs) {
    const now = performance.now();
    if (now - (this.cool.get(k) ?? -1e9) < secs * 1000) return false;
    this.cool.set(k, now);
    return true;
  }

  _slots(extra = {}) {
    const m = this.match;
    const s = this.sum;
    const onTop = s.momentum > 0 ? m.teamA : m.teamB;
    return {
      team: m.teamA.def.name, opp: m.teamB.def.name,
      score: `${m.teamA.def.code} ${m.scoreA}–${m.scoreB} ${m.teamB.def.code}`,
      min: m.clockText().split("'")[0],
      chain: s.chain,
      onTop: onTop.def.name,
      ...extra,
    };
  }

  _key(type, extra) {
    if (this.mode === 'off') return;
    this.lastKeyAt = performance.now();
    this.sum.epoch++; // key moments invalidate any pending model color
    const line = pickLine(this.mode, type, this._slots(extra), this.recent, this.openers);
    if (line) this._say(line, 'pbp', true);
    // two-man booth: the analyst weighs in after the big moments
    const aside = type.startsWith('goal') ? 'aside_goal'
      : type === 'save_big' ? 'aside_save'
      : type === 'nearMiss' || type === 'woodwork' ? 'aside_miss' : null;
    if (aside && !(type === 'nearMiss' && Math.random() < 0.5)) this._queueAside(aside, extra);
  }

  _queueAside(type, extra, tries = 3) {
    const keyAt = this.lastKeyAt;
    clearTimeout(this._asideT);
    this._asideT = setTimeout(() => {
      // still the same moment? (no newer key line, booth on, match attached)
      if (this.mode === 'off' || !this.match || this.lastKeyAt !== keyAt) return;
      if (this.speaking) {
        // play-by-play still talking — wait for the mic, don't drop the aside
        if (tries > 0) this._queueAside(type, extra, tries - 1);
        return;
      }
      const line = pickLine(this.mode, type, this._slots(extra), this.recent, this.openers);
      if (line) this._say(line, 'ana', false);
    }, tries === 3 ? 3400 : 1800);
  }

  // ---- build-up color ------------------------------------------------------------

  update(dt, live) {
    this.live = live;
    if (!live || this.mode === 'off' || !this.match) return;
    this.colorT -= dt;
    if (this.colorT > 0) return;
    this.colorT = 12 + Math.random() * 8;
    if (this.speaking || performance.now() - this.lastKeyAt < 5000) return;
    this._modelColor() || this._templateColor();
  }

  _colorTopic() {
    const m = this.match, s = this.sum;
    const min = parseInt(m.clockText()) || 0;
    const diff = Math.abs(m.scoreA - m.scoreB);
    const cands = [];
    if (s.chain >= 4) cands.push(['chain', { team: (s.chainTeam === 'A' ? m.teamA : m.teamB).def.name }]);
    if (m.ball.owner && m.ball.owner.ownerT > 2.6) cands.push(['dribble', { player: m.ball.owner.name }]);
    if (Math.abs(s.momentum) > 0.6) {
      const top = s.momentum > 0 ? m.teamA : m.teamB;
      cands.push(['dominance', { team: top.def.name, opp: m.otherTeam(top).def.name }]);
    }
    for (const t of [m.teamA, m.teamB]) {
      if (t.intent === 'commit' || t.intent === 'bunker' || t.intent === 'counterpress') {
        cands.push([`intent_${t.intent}`, { team: t.def.name }]);
      }
    }
    if (diff === 0 && min > 68) cands.push(['levelLate', {}]);
    if (diff >= 3) cands.push(['blowout', { team: (m.scoreA > m.scoreB ? m.teamA : m.teamB).def.name, opp: (m.scoreA > m.scoreB ? m.teamB : m.teamA).def.name }]);
    if (s.shots.A + s.shots.B < 2 && min > 25) cands.push(['cagey', {}]);
    cands.push(['filler', {}]);
    return cands[(Math.random() * cands.length) | 0];
  }

  _templateColor() {
    const [type, extra] = this._colorTopic();
    const line = pickLine(this.mode, type, this._slots(extra), this.recent, this.openers);
    if (line) this._say(line, 'ana', false);
  }

  // ---- optional model color (3b) --------------------------------------------------
  // Small in-browser model (Web Worker + WebGPU) generates ONLY the rate-limited
  // build-up color. Never on the event path, never awaited, dropped when stale.

  _warmModel() {
    if (this._llm || this._llmDead) return;
    if (typeof navigator === 'undefined' || !navigator.gpu || typeof Worker === 'undefined') {
      this._llmDead = true;
      return;
    }
    this._llm = { state: 'probing', worker: null, reqId: 0, pending: null };
    // adapter probe BEFORE any network: no WebGPU → no download, ever
    navigator.gpu.requestAdapter().then((adapter) => {
      if (!adapter || !this._llm) return this._killLlm();
      this._spawnLlm();
    }).catch(() => this._killLlm());
  }

  _spawnLlm() {
    try {
      const w = new Worker('./src/llm-worker.js', { type: 'module' });
      this._llm.worker = w;
      this._llm.state = 'loading';
      let progressAt = performance.now();
      w.onmessage = (e) => {
        const m = e.data;
        if (!this._llm) return;
        if (m.t === 'progress') progressAt = performance.now();
        else if (m.t === 'ready') this._llm.state = 'ready';
        else if (m.t === 'fail') this._killLlm();
        else if (m.t === 'line') this._onModelLine(m);
      };
      w.onerror = () => this._killLlm();
      w.postMessage({ t: 'init', cdn: LLM_CDN, model: LLM_MODEL });
      // watchdog: stalled download (blocked/throttled CDN) → give up silently
      const watch = setInterval(() => {
        if (!this._llm || this._llm.state === 'ready') return clearInterval(watch);
        if (performance.now() - progressAt > 30000) { clearInterval(watch); this._killLlm(); }
      }, 5000);
    } catch {
      this._killLlm();
    }
  }

  _killLlm() {
    try { this._llm?.worker?.terminate(); } catch {}
    this._llm = null;
    this._llmDead = true; // templates carry the booth from here on
  }

  _modelColor() {
    const L = this._llm;
    if (!L || L.state !== 'ready') return false;
    if (L.pending) {
      // a generation that never returned shouldn't wedge the booth
      if (performance.now() - L.pending.at > 12000) L.pending = null;
      return false;
    }
    const [type, extra] = this._colorTopic();
    const id = ++L.reqId;
    L.pending = { id, epoch: this.sum.epoch, at: performance.now() };
    const avoid = this.recent.slice(-4).map((t) => t.slice(0, 40)).join(' | ');
    L.worker.postMessage({
      t: 'gen', id,
      messages: [
        { role: 'system', content: LLM_PERSONA[this.mode] },
        { role: 'user', content: `Match state: ${this.sum.text(this.match)}. Talk about: ${type} ${JSON.stringify(extra)}. `
          + `Reply with ONE sentence of color commentary, under 15 words, no quotes, no hashtags. Avoid resembling: ${avoid}` },
      ],
    });
    return true; // this color slot is spoken async (or dropped if stale)
  }

  _onModelLine(m) {
    const req = this._llm?.pending;
    if (!req || req.id !== m.id) return;
    this._llm.pending = null;
    if (!m.text || this.mode === 'off' || !this.match || !this.live) return;
    // stale guards: possession flipped / key moment landed since the request
    if (req.epoch !== this.sum.epoch || this.speaking) return;
    if (performance.now() - this.lastKeyAt < 5000) return;
    const line = m.text.trim().replace(/^["'“”]+|["'“”]+$/g, '').split('\n')[0];
    if (line.length < 4 || line.length > 150) return;
    this._say(line, 'ana', false);
  }

  // ---- delivery -------------------------------------------------------------------

  // Resolve the two booth voices for the current persona from the installed
  // set: named preference first, language family as fallback, and (unless the
  // persona is single-voice) guaranteed distinct play-by-play vs analyst.
  _computeVoices() {
    const p = PERSONAS[this.mode];
    this._pbpV = this._anaV = null;
    if (!p) return;
    if (!this._voices.length && typeof speechSynthesis !== 'undefined') {
      this._voices = speechSynthesis.getVoices(); // some engines populate late
    }
    if (!this._voices.length) return;
    // language-family pool (first family that has any installed voice)
    let pool = this._voices.slice();
    for (const lang of [...p.langs, 'en']) {
      const hit = this._voices.filter((v) => v.lang?.startsWith(lang));
      if (hit.length) { pool = hit; break; }
    }
    const byName = (names, exclude) => {
      for (const n of names || []) {
        const v = this._voices.find(
          (x) => x !== exclude && x.name?.toLowerCase().includes(n.toLowerCase()));
        if (v) return v;
      }
      return null;
    };
    const pbp = byName(p.voice?.pbp) || pool[0] || this._voices[0] || null;
    this._pbpV = pbp;
    if (p.same) { this._anaV = pbp; return; } // one voice by design (HYPE)
    this._anaV = byName(p.voice?.ana, pbp) || pool.find((v) => v !== pbp) || pbp;
  }

  _voiceFor(reg) {
    if (this._voicesForMode !== this.mode || (!this._pbpV && this._voices.length)) {
      this._computeVoices();
      this._voicesForMode = this.mode;
    }
    return reg === 'ana' ? this._anaV : this._pbpV;
  }

  _say(line, reg, interrupt) {
    const p = PERSONAS[this.mode];
    const who = reg === 'ana' ? p.duo[1] : p.duo[0];
    this._show(line, who); // captions always render, voice or not
    if (typeof speechSynthesis === 'undefined' || !this.voiceOn || this.audio.muted) return;
    if (!interrupt && this.speaking) return;
    const wasSpeaking = this.speaking;
    if (interrupt) this._stopSpeech();
    this.speaking = true;
    this.audio.duckCrowd(0.35);
    const done = () => {
      this.speaking = false;
      clearInterval(this._resumeIv);
      this.audio.duckCrowd(this.mode === 'off' ? 1 : 0.8);
    };
    const speak = () => {
      if (this.mode === 'off' || !this.voiceOn || this.audio.muted) { this.speaking = false; return; }
      try {
        const u = new SpeechSynthesisUtterance(line);
        const v = this._voiceFor(reg);
        if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = reg === 'ana' ? p.anaRate : p.rate;
        u.pitch = reg === 'ana' ? p.anaPitch : p.pitch;
        u.volume = 1;
        u.onend = done;
        u.onerror = done;
        this._utter = u; // retain a reference: Chrome GCs in-flight utterances → silence
        // belt & braces: some engines drop onend
        clearTimeout(this._sayT);
        this._sayT = setTimeout(done, 1000 + line.length * 60);
        // engine can be left paused (backgrounded tab, a prior cancel) → speak
        // then silently does nothing; clear that state before AND after.
        try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch {}
        speechSynthesis.speak(u);
        // some Chrome/macOS builds start synthesis paused → captions but no audio;
        // a resume right after speak, plus a light watchdog, unsticks it
        try { speechSynthesis.resume(); } catch {}
        clearInterval(this._resumeIv);
        this._resumeIv = setInterval(() => {
          try { if (speechSynthesis.speaking) speechSynthesis.resume(); } catch {}
        }, 4000);
      } catch (e) {
        this.speaking = false;
        console.warn('[booth] speak failed', e);
      }
    };
    clearTimeout(this._speakT);
    // Chrome/Safari silently drop a speak() issued in the same tick as cancel().
    // _stopSpeech() (called above whenever interrupt is set) issues that cancel,
    // so ANY interrupted line must let the queue clear first — not just the ones
    // where we were already mid-utterance. This was swallowing every idle-booth
    // play-by-play call (goals, big saves) → the booth looked mute.
    void wasSpeaking;
    if (interrupt) this._speakT = setTimeout(speak, 80);
    else speak();
  }

  // Fire a silent, empty utterance from inside a user gesture so the synth
  // engine is unlocked for later event-driven (non-gesture) calls. Empty text
  // resolves instantly on every engine (a whitespace utterance can wedge the
  // queue on some), and getVoices() usually populates right after.
  _prime() {
    if (this._primed || typeof speechSynthesis === 'undefined') return;
    this._primed = true;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      u.onend = u.onerror = () => {};
      speechSynthesis.speak(u);
      speechSynthesis.resume();
      this._voices = speechSynthesis.getVoices();
      this._voicesForMode = null;
    } catch {}
  }

  // Console diagnostic: run `pp.booth.testSpeak()` in devtools. Logs the TTS
  // state and forces one spoken line independent of match/event flow, so we can
  // tell "engine is mute" apart from "events aren't firing".
  testSpeak(text = 'Testing the booth, one two.') {
    const has = typeof speechSynthesis !== 'undefined';
    const info = {
      supported: has,
      voiceCount: (this._voices || []).length,
      primed: !!this._primed,
      mode: this.mode, voiceOn: this.voiceOn, muted: this.audio?.muted,
      paused: has ? speechSynthesis.paused : null,
      speaking: has ? speechSynthesis.speaking : null,
    };
    console.log('[booth] TTS diag', info);
    if (!has) return info;
    try {
      speechSynthesis.cancel();
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(text);
        const v = this._voiceFor('pbp');
        if (v) { u.voice = v; u.lang = v.lang; }
        u.onstart = () => console.log('[booth] onstart — voice:', v?.name ?? 'default');
        u.onend = () => console.log('[booth] onend');
        u.onerror = (e) => console.warn('[booth] onerror:', e.error);
        speechSynthesis.speak(u);
        speechSynthesis.resume();
      }, 80);
    } catch (e) { console.warn('[booth] testSpeak threw', e); }
    return info;
  }

  _stopSpeech() {
    clearTimeout(this._speakT);
    clearTimeout(this._sayT);
    clearInterval(this._resumeIv);
    try {
      if (this._utter) { this._utter.onend = null; this._utter.onerror = null; } // stale handler must not clobber new state
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {}
    this.speaking = false;
  }

  // audio panel: mute the spoken voice but keep the captions
  setVoice(on) {
    this.voiceOn = on;
    localStorage.setItem('pp-voice', on ? '1' : '0');
    if (!on) this._stopSpeech();
  }

  syncMute() {
    if (this.audio.muted) this._stopSpeech();
  }

  _show(line, who) {
    if (!this.ticker) return;
    this.ticker.innerHTML = `<b>${who}</b>&nbsp; ${line}`;
    this.ticker.classList.remove('hidden');
    this.ticker.style.opacity = 1;
    clearTimeout(this._tickT);
    this._tickT = setTimeout(() => { this.ticker.style.opacity = 0; }, 6000);
  }

  _hideTicker() {
    if (this.ticker) { this.ticker.style.opacity = 0; this.ticker.classList.add('hidden'); }
  }
}
