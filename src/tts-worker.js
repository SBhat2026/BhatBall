// Neural commentary voice (module worker). kokoro-js + its ONNX runtime are
// fetched from a CDN only after a commentary mode is engaged; weights come from
// the HuggingFace ONNX mirror. Any failure — blocked CDN, no WebGPU/WASM, wiped
// cache — posts 'fail' and the booth silently falls back to browser speech
// synthesis (and then to captions). Nothing here ever touches the page or frame
// loop; PCM is transferred back so the main thread just plays it on the bus.
let tts = null;

onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'init') {
    try {
      const { KokoroTTS } = await import(m.cdn);
      tts = await KokoroTTS.from_pretrained(m.model, {
        dtype: m.dtype,
        device: m.device,
        progress_callback: (p) => postMessage({ t: 'progress', p: p?.progress ?? 0 }),
      });
      // warm: first synthesis pays the one-time kernel/shader compile behind the
      // browser-speech curtain, so the first real line isn't the slow one
      await tts.generate('Ready.', { voice: m.warmVoice || 'af_heart' });
      postMessage({ t: 'ready', voices: Object.keys(tts.voices || {}) });
    } catch (err) {
      postMessage({ t: 'fail', err: String(err) });
    }
  } else if (m.t === 'gen' && tts) {
    try {
      const a = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
      const pcm = a.audio; // Float32Array
      postMessage({ t: 'audio', id: m.id, pcm, sampleRate: a.sampling_rate }, [pcm.buffer]);
    } catch (err) {
      // one dud line must not wedge the booth — report empty so it falls back
      postMessage({ t: 'audio', id: m.id, pcm: null, err: String(err) });
    }
  }
};
