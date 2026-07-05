// Commentary booth. The template engine IS the product: a large slot-filled
// line bank per persona, driven by match-loop event taps, with an xG-style
// chance read and a rolling match summary so lines sound aware. Speech is
// browser speechSynthesis + a bottom ticker (the ticker always works); the
// crowd bus ducks while the commentator talks. Everything degrades:
// model → templates → ticker captions, never an error. The pure helpers up
// top are DOM-free so tools can unit-test them in node.

const RECENT_MAX = 12;

// --- chance quality ------------------------------------------------------------
// Cheap xG from what the shot logic already knows: distance, angle, blockers.
export function xgFor(dist, absZ, blockers = 0) {
  const angle = 1 / (1 + (absZ / Math.max(4, dist)) * 2.2);
  const v = 0.95 * Math.exp(-dist / 11.5) * angle - blockers * 0.055;
  return Math.min(0.9, Math.max(0.02, v));
}

// --- personas -------------------------------------------------------------------
// duo: [play-by-play, analyst] — the analyst register lands in 3d/model color.
export const PERSONAS = {
  bbc: {
    label: 'BBC', duo: ['Peter', 'Gary'], langs: ['en-GB'],
    rate: 1.02, pitch: 1.0, anaRate: 0.96, anaPitch: 0.9,
  },
  hype: {
    label: 'HYPE', duo: ['Andrés', 'Rafa'], langs: ['es-ES', 'es-MX', 'es-US', 'es'],
    rate: 1.12, pitch: 1.06, anaRate: 1.04, anaPitch: 0.95,
  },
  dry: {
    label: 'DRY', duo: ['Chuck', 'Stan'], langs: ['en-US'],
    rate: 0.96, pitch: 0.92, anaRate: 0.92, anaPitch: 0.85,
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
  }

  initUI(btn, modeEl, ticker) {
    this.btn = btn;
    this.modeEl = modeEl;
    this.ticker = ticker;
    const saved = localStorage.getItem('pp-comm');
    if (MODES.includes(saved)) this.mode = saved;
    this._paintMode();
    btn.onclick = () => this.cycle();
    if (typeof speechSynthesis !== 'undefined') {
      this._voices = speechSynthesis.getVoices();
      speechSynthesis.addEventListener?.('voiceschanged', () => {
        this._voices = speechSynthesis.getVoices();
      });
    }
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    localStorage.setItem('pp-comm', this.mode);
    this._paintMode();
    this._stopSpeech();
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

  // 3b hooks — overridden when the optional model tier is wired in
  _warmModel() {}
  _modelColor() { return false; }

  // ---- delivery -------------------------------------------------------------------

  _voiceFor(reg) {
    const p = PERSONAS[this.mode];
    if (!p || !this._voices.length) return null;
    const langs = [...p.langs, 'en'];
    // 3d: analyst prefers a *different* voice in the same language family
    const ranked = [];
    for (const lang of langs) {
      for (const v of this._voices) if (v.lang?.startsWith(lang)) ranked.push(v);
      if (ranked.length) break;
    }
    if (!ranked.length) return this._voices[0] ?? null;
    if (reg === 'ana' && ranked.length > 1) return ranked[1];
    return ranked[0];
  }

  _say(line, reg, interrupt) {
    const p = PERSONAS[this.mode];
    const who = reg === 'ana' ? p.duo[1] : p.duo[0];
    this._show(line, who);
    if (typeof speechSynthesis === 'undefined' || this.audio.muted) return;
    if (interrupt) this._stopSpeech();
    else if (this.speaking) return;
    try {
      const u = new SpeechSynthesisUtterance(line);
      const v = this._voiceFor(reg);
      if (v) u.voice = v;
      u.rate = reg === 'ana' ? p.anaRate : p.rate;
      u.pitch = reg === 'ana' ? p.anaPitch : p.pitch;
      u.volume = 1;
      this.speaking = true;
      this.audio.duckCrowd(0.35);
      const done = () => {
        this.speaking = false;
        this.audio.duckCrowd(this.mode === 'off' ? 1 : 0.8);
      };
      u.onend = done;
      u.onerror = done;
      // belt & braces: some engines drop onend
      clearTimeout(this._sayT);
      this._sayT = setTimeout(done, 1500 + line.length * 75);
      speechSynthesis.speak(u);
    } catch {
      this.speaking = false;
    }
  }

  _stopSpeech() {
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch {}
    this.speaking = false;
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
