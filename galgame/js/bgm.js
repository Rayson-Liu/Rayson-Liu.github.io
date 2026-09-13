/* Procedural soothing BGM — Japanese pentatonic ambient piano */
(function () {
  "use strict";

  let ctx = null;
  let master = null;
  let delay = null;
  let feedback = null;
  let wet = null;
  let timer = null;
  let playing = false;
  let step = 0;
  let nextTime = 0;

  // A pentatonic (hirajōshi-ish) — gentle school afternoon
  // scale degrees in semitones from A3
  const SCALE = [0, 2, 3, 7, 8, 12, 14, 15, 19, 20, 24, 26];
  const ROOT = 220; // A3

  // melody pattern (scale indices), 32 steps
  const MELODY = [
    4, null, 3, null, 5, null, 4, 3,
    2, null, 3, null, 4, null, null, null,
    5, null, 6, null, 5, 4, 3, null,
    2, null, 1, null, 2, null, null, null,
  ];
  // bass roots per 8 steps
  const BASS = [0, 2, 1, 3];
  // soft pad chords (scale indices)
  const PADS = [
    [0, 2, 4],
    [1, 3, 5],
    [0, 2, 4],
    [1, 3, 4],
  ];

  function freq(idx) {
    const n = SCALE[((idx % SCALE.length) + SCALE.length) % SCALE.length];
    return ROOT * Math.pow(2, n / 12);
  }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.38;
    feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    wet = ctx.createGain();
    wet.gain.value = 0.22;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    return true;
  }

  function piano(t, f, dur, vel, dest) {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    o1.type = "sine";
    o2.type = "triangle";
    o1.frequency.value = f;
    o2.frequency.value = f * 2.001;
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(Math.min(2800, f * 6), t);
    filt.frequency.exponentialRampToValueAtTime(600, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(g);
    o2.connect(g);
    o2.detune.value = 4;
    g.connect(filt);
    filt.connect(master);
    filt.connect(delay);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  function pad(t, f, dur, vel) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    o.type = "sine";
    o.frequency.value = f;
    filt.type = "lowpass";
    filt.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    g.connect(filt);
    filt.connect(master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function scheduleStep(t, s) {
    const bar = Math.floor(s / 8) % 4;
    const m = MELODY[s % MELODY.length];
    if (m != null && s % 2 === 0) {
      const v = 0.07 + (s % 8 === 0 ? 0.02 : 0);
      piano(t, freq(m + 4), 1.4, v);
    }
    // soft arp sparkle every 4
    if (s % 4 === 2 && Math.random() > 0.45) {
      piano(t, freq((m == null ? 3 : m) + 7), 0.7, 0.03);
    }
    // bass
    if (s % 8 === 0) {
      piano(t, freq(BASS[bar]), 2.2, 0.055);
      piano(t, freq(BASS[bar] + 2), 1.6, 0.03);
    }
    // pad at bar start
    if (s % 8 === 0) {
      const chord = PADS[bar];
      chord.forEach((c, i) => {
        pad(t, freq(c + (i === 0 ? 0 : 2)), 3.6, 0.022);
      });
    }
  }

  function tick() {
    if (!playing || !ctx) return;
    const spb = 0.42; // step duration — gentle
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(nextTime, step);
      nextTime += spb;
      step = (step + 1) % 32;
    }
    timer = setTimeout(tick, 40);
  }

  function start() {
    if (!ensure()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (playing) return;
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 1.2);
    tick();
  }

  function stop() {
    playing = false;
    if (timer) clearTimeout(timer);
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    }
  }

  function setVolume(v) {
    if (ctx && master) master.gain.value = Math.max(0, Math.min(1, v));
  }

  window.BGM = { start, stop, setVolume, get playing() { return playing; } };
})();
