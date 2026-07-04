# Commentary Plan — in-browser LLM announcer

Decisions locked 2026-07-04: **WebLLM in-browser** (works on GitHub Pages / school
Macs), **text ticker + TTS** with crowd ducking (commentary on → crowd subdued;
commentary muted → crowd back to full), **three selectable personas with accents**
behind a visible top-right 🎙 button, scope = **key moments + build-up color**.

## Architecture

```
match hooks ──► src/commentary.js (event bus + state)
                   │  events: goal, save, nearMiss, foul/pen, kickoff/HT/FT,
                   │          buildup color (pass chains, possession spells)
                   ▼
             line source (two paths)
        ┌──────────┴───────────┐
   template engine        WebLLM worker (lazy)
   (instant, always       @mlc-ai/web-llm, Qwen2.5-0.5B/1.5B-Instruct q4f16
    available)            WebGPU; ~350–900MB one-time download, cached by
        └──────────┬───────────┘  the browser (Cache API)
                   ▼
             delivery layer
        ticker div (bottom, above power bar)
        speechSynthesis utterance → audio.duckCrowd(0.35) onstart,
                                    duckCrowd(1) onend
```

## Event capture (inputs = who has the ball + passes, as requested)

- Hook into `Match` via existing `hooks` plus a light tap in `_control`:
  every ownership change pushes `{t, player, team, x}` into a rolling spell log.
- Key moments (always commented): goal (scorer, assist = previous owner same
  team, minute, score), GK save/parry (`gkUpdate` save branch), near miss
  (ball crosses goal line outside mouth within 1.5m of a post while `isShot`),
  foul → free kick/penalty, kickoff, half-time, full-time, golden goal.
- Build-up color (rate-limited to ~1 per 12–20s, dropped when a key moment
  is pending): pass chains ≥4 on one team, a one-two (`oneTwoT` window
  conversion), a switch of play, a long dribble (`ownerT > 3s`), possession
  spell dominance, scoreline mood regime changes (already computed).

## Prompting (small model, tight leash)

- System prompt = persona card + match card (teams, score, minute).
- User message = one compact JSON event.
- Contract: “ONE line, under 18 words, no hashtags, no quotes.”
- `temperature 0.9, max_tokens 28`; one request in flight, queue depth 1,
  stale build-up jobs dropped when a key moment lands; 6s timeout → template.
- Anti-repetition: keep last 6 lines in the prompt as “do not repeat”.

## Personas (🎙 button top-right, always visible — unlike the dev ⚙︎)

Cycle OFF → BBC → HYPE → DRY; persisted in `localStorage pp-comm`.

| Persona | Style | TTS voice pick |
|---|---|---|
| BBC | calm, wry, understated | first `en-GB` voice (Daniel), rate 1.0 |
| HYPE | excitable, rolling GOOOL calls, Spanglish | first `es-ES`/`es-MX` voice (Mónica/Paulina), rate 1.08 |
| DRY | deadpan American, light roasts | first `en-US` voice (Samantha), rate 0.95 |

Voice chosen from `speechSynthesis.getVoices()` by lang prefix with graceful
fallback to default voice; HYPE persona's prompt asks for Spanish-flavored
lines so the Spanish voice reads naturally.

## Audio ducking (already implemented in audio.js this commit)

- `audio.duckCrowd(mult)` scales the whole crowd bus (bed, swells, roar, chants).
- Commentary enabled: baseline duck 0.75; while an utterance plays: 0.35.
- Commentary OFF or M-muted: duck 1.0 — crowd is the star again.

## Loading UX

- 🎙 first enable → persona picked → WebLLM engine boots in a Web Worker
  (`WebWorkerMLCEngine`) with download progress written into the ticker
  (“warming up the booth… 42%”). Templates carry all commentary until ready,
  and remain the permanent fallback (no WebGPU / school network blocks the
  model CDN / generation timeout).

## Phases

1. **P1 – booth shell**: 🎙 button, ticker, template engine (~120 canned lines
   across 3 personas with slot-filling), TTS + ducking. Ships value immediately.
2. **P2 – WebLLM**: worker engine, prompt plumbing, fallback wiring.
   Model: start `Qwen2.5-0.5B-Instruct-q4f16_1` (fast), option to swap 1.5B.
3. **P3 – polish**: anti-repetition memory, assist detection, name
   pronunciation hints (SSML-ish respellings for TTS), persona-specific
   goal-call lengths.
4. **P4 – two-man booth**: play-by-play + color pair exchanging lines
   (single model, alternating persona prompts).

## Risks

- School-network CDN blocks → templates cover 100% of events by design.
- WebGPU absent (older Safari) → feature-detect, hide the LLM tier.
- TTS voice availability varies per machine → lang-prefix fallback chain.
- Latency on 8GB Macs with 1.5B → default to 0.5B; lines are ≤28 tokens.
