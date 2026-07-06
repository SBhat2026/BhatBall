// Spanish commentary voice (module worker). Piper via vits-web: the one engine
// that gives HYPE real MALE Spanish voices, fully in-browser and offline after
// the first voice download (weights come from the HuggingFace piper-voices
// mirror, cached in OPFS). Any failure posts 'fail' and the booth falls back to
// browser speech, then captions — same never-error contract as the Kokoro path.
// predict() returns a WAV Blob; we hand the raw bytes back and let the main
// thread decode + play on the voice bus.
let tts = null;

onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'init') {
    try {
      tts = await import(m.cdn);
      // prefetch both voices with progress so the watchdog sees life, then warm
      for (const v of m.voiceList || []) {
        try { await tts.download(v, (p) => postMessage({ t: 'progress', p: p?.loaded && p?.total ? p.loaded / p.total : 0 })); } catch {}
      }
      await tts.predict({ text: 'Listo.', voiceId: m.warmVoice || (m.voiceList && m.voiceList[0]) });
      postMessage({ t: 'ready', voices: m.voiceList || [] });
    } catch (err) {
      postMessage({ t: 'fail', err: String(err) });
    }
  } else if (m.t === 'gen' && tts) {
    try {
      const wav = await tts.predict({ text: m.text, voiceId: m.voice });
      const ab = await wav.arrayBuffer();
      postMessage({ t: 'audio', id: m.id, wav: ab }, [ab]);
    } catch (err) {
      postMessage({ t: 'audio', id: m.id, wav: null, err: String(err) });
    }
  }
};
