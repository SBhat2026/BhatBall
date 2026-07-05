// Optional color-commentary model (module worker). The runtime library and
// weights are fetched from CDNs only after the user engages a commentary
// mode AND a WebGPU adapter probe passed on the main thread. Any failure —
// blocked CDN, no adapter, wiped cache — posts 'fail' and the booth stays on
// templates forever, silently. Nothing here ever touches the page or frame loop.
let engine = null;

onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'init') {
    try {
      const webllm = await import(m.cdn);
      engine = await webllm.CreateMLCEngine(m.model, {
        initProgressCallback: (p) => postMessage({ t: 'progress', p: p.progress ?? 0 }),
      });
      // pre-warm: pay the one-time WebGPU shader compile behind the template curtain
      await engine.chat.completions.create({
        messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 3,
      });
      postMessage({ t: 'ready' });
    } catch (err) {
      postMessage({ t: 'fail', err: String(err) });
    }
  } else if (m.t === 'gen' && engine) {
    try {
      const r = await engine.chat.completions.create({
        messages: m.messages, max_tokens: 24, temperature: 0.9,
      });
      postMessage({ t: 'line', id: m.id, text: r.choices?.[0]?.message?.content ?? null });
    } catch {
      postMessage({ t: 'line', id: m.id, text: null });
    }
  }
};
