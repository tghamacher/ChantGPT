// Playback: a chant heard as it's read, to check it by ear (a flat missed, a note a step off). Notes from
// CGChant.perform, played on a soft organ-like voice through Web Audio, nothing to load; each event's onStep as it
// sounds (the page marks the neume), onEnd when done or stopped.
(function (global) {
  'use strict';
  let ac = null, out = null, run = null;

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function voice(m, t, d) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + Math.max(0.03, d - 0.06));
    g.gain.linearRampToValueAtTime(0, t + d);
    g.connect(out);
    for (const [type, mul, level] of [['triangle', 1, 1], ['sine', 2, 0.25]]) {
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = type; o.frequency.value = hz(m) * mul; v.gain.value = level;
      o.connect(v); v.connect(g); o.start(t); o.stop(t + d + 0.02);
    }
  }

  // events: [{ midi (null: a rest), beats }]; bpm: beats a minute
  function play(events, bpm, onStep, onEnd) {
    stop();
    if (!events.length) { if (onEnd) onEnd(); return; }
    ac = ac || new (global.AudioContext || global.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination);
    const beat = 60 / bpm, t0 = ac.currentTime + 0.08, at = [];
    let t = t0;
    for (const e of events) { at.push(t); if (e.midi !== null) voice(e.midi, t, e.beats * beat * 0.97); t += e.beats * beat; }
    const end = t;
    run = { events, at, end, k: -1, onStep, onEnd, paused: false, frame: 0 };
    const tick = () => {
      if (!run) return;
      const now = ac.currentTime;
      let k = run.k;
      while (k + 1 < at.length && at[k + 1] <= now) k++;
      if (k !== run.k) { run.k = k; if (k >= 0 && run.onStep) run.onStep(events[k], k); }
      if (now >= end) { const f = run.onEnd; run = null; if (f) f(); return; }
      run.frame = requestAnimationFrame(tick);
    };
    run.frame = requestAnimationFrame(tick);
  }
  function pause() { if (run && ac && ac.state === 'running') { ac.suspend(); run.paused = true; } }
  function resume() { if (run && ac && ac.state === 'suspended') { ac.resume(); run.paused = false; } }
  function stop() {
    if (!run) return;
    const f = run.onEnd;
    cancelAnimationFrame(run.frame);
    if (out) { try { out.disconnect(); } catch (e) { } out = null; }
    run = null;
    if (ac && ac.state === 'suspended') ac.resume();
    if (f) f();
  }
  // one note, at once (a neume heard when it's changed)
  function note(midi, sec = 0.4) {
    ac = ac || new (global.AudioContext || global.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const g = ac.createGain(); g.connect(ac.destination);
    const keep = out; out = g; voice(midi, ac.currentTime + 0.01, sec); out = keep;
  }

  global.CGPlay = {
    play, pause, resume, stop, note,
    get playing() { return !!run && !run.paused; }, get paused() { return !!run && run.paused; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
