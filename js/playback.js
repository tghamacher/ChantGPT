// Playback: a chant, or mensural voices together, heard as they're read, to check them by ear (a flat missed, a note
// a step off, a voice a beat ahead). Notes from CGChant.perform or CGMensural.perform, played through Web Audio,
// nothing to load, on Serenissima Press's soft organ-like tone (a few harmonics, a gentle attack and release, a
// compressor at the end); several voices each a little apart in the stereo field, and each can be silenced while it
// plays (mute). Each event's onStep as it sounds (the page marks the note), onEnd when done or stopped.
(function (global) {
  'use strict';
  let ac = null, master = null, wave = null, out = null, run = null;
  const muted = new Set();                                   // (voices silenced: kept from one playing to the next)
  let gains = new Map();                                     // (this playing's voices: name → its gain, to silence it)

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  // the sound itself, made once: harmonics as Serenissima Press has them, through a compressor
  function audio() {
    if (!ac) ac = new (global.AudioContext || global.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    if (!master) {
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain(); master.gain.value = 0.9; master.connect(comp); comp.connect(ac.destination);
      wave = ac.createPeriodicWave(new Float32Array([0, 1, 0.42, 0.2, 0.1, 0.05, 0.025]), new Float32Array(7));
    }
  }
  // one note: m (MIDI) from t for d seconds at peak, into dest
  function voice(m, t, d, peak, dest) {
    const t1 = t + Math.max(0.06, d - 0.03), o = ac.createOscillator(), g = ac.createGain();
    o.setPeriodicWave(wave); o.frequency.value = hz(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak, Math.max(t + 0.03, t1 - 0.02)); g.gain.linearRampToValueAtTime(0, t1 + 0.06);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t1 + 0.08);
  }

  // events: [{ midi (null: a rest), beats, voice? }], one after another; or, when they have at (beats from the start,
  // in order), each at its time, so that several voices sound together. bpm: beats a minute. onStep(event, k) as each
  // begins.
  function play(events, bpm, onStep, onEnd) {
    stop();
    if (!events.length) { if (onEnd) onEnd(); return; }
    audio();
    out = ac.createGain(); out.gain.value = 1; out.connect(master);
    // (each voice its own way out: a gain, to silence it, and its place in the stereo field)
    const names = [...new Set(events.map(e => e.voice).filter(v => v !== undefined && v !== null && v !== ''))], k = names.length;
    gains = new Map();
    names.forEach((v, i) => {
      const g = ac.createGain(); g.gain.value = muted.has(v) ? 0 : 1;
      const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (p) { p.pan.value = k > 1 ? (i / (k - 1) - 0.5) * 0.8 : 0; g.connect(p); p.connect(out); } else g.connect(out);
      gains.set(v, g);
    });
    const beat = 60 / bpm, t0 = ac.currentTime + 0.08, at = [], timed = events.every(e => Number.isFinite(e.at));
    const peak = timed && k > 1 ? 0.5 / Math.max(2, k) : 0.25;
    let t = t0, end = t0;
    for (const e of events) {
      if (timed) t = t0 + e.at * beat;
      at.push(t);
      if (e.midi !== null) voice(e.midi, t, e.beats * beat, peak, gains.get(e.voice) || out);
      end = Math.max(end, t + e.beats * beat);
      if (!timed) t += e.beats * beat;
    }
    run = { events, at, end, k: -1, onStep, onEnd, paused: false, frame: 0 };
    const tick = () => {
      if (!run) return;
      const now = ac.currentTime;
      // (every event begun since the last frame, in order: in several voices, more than one at a time; a silenced
      // voice's not marked)
      while (run.k + 1 < at.length && at[run.k + 1] <= now) { run.k++; const e = events[run.k]; if (run.onStep && !muted.has(e.voice)) run.onStep(e, run.k); }
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
    gains = new Map();
    run = null;
    if (ac && ac.state === 'suspended') ac.resume();
    if (f) f();
  }
  // a voice silenced (on) or heard again: at once, while it plays too, and for the next playing
  function mute(v, on) {
    if (on) muted.add(v); else muted.delete(v);
    const g = gains.get(v);
    if (g && ac) g.gain.setTargetAtTime(on ? 0 : 1, ac.currentTime, 0.02);
  }
  // one note, at once (a neume heard when it's changed)
  function note(midi, sec = 0.4) {
    audio();
    voice(midi, ac.currentTime + 0.01, sec, 0.25, master);
  }

  global.CGPlay = {
    play, pause, resume, stop, note, mute,
    isMuted: v => muted.has(v),
    get playing() { return !!run && !run.paused; }, get paused() { return !!run && run.paused; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
