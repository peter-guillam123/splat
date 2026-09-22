// All sound is synthesised in WebAudio — no audio files.
// The context can only start after a user gesture, so ensure() is called
// from the first pointer/key handler in game.js.
(function () {
  class SFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.windGain = null;
      this.windFilter = null;
      this.muted = localStorage.getItem('splat.muted') === '1';
    }

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);

        // looping white-noise bed for wind
        const len = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        this.windFilter = this.ctx.createBiquadFilter();
        this.windFilter.type = 'bandpass';
        this.windFilter.frequency.value = 300;
        this.windFilter.Q.value = 0.8;
        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0;
        src.connect(this.windFilter).connect(this.windGain).connect(this.master);
        src.start();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(m) {
      this.muted = m;
      localStorage.setItem('splat.muted', m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 1;
    }

    // speed01: 0 = hanging still, 1 = terminal velocity
    wind(speed01) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.windGain.gain.setTargetAtTime(speed01 * 0.14, t, 0.12);
      this.windFilter.frequency.setTargetAtTime(250 + speed01 * 750, t, 0.12);
    }

    _noiseBurst(dur, gainV, filterType, freq) {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gainV, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }

    _tone(type, f0, f1, dur, gainV, delay = 0) {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gainV, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    floof() {  // canopy inflating: a soft airy "floof", not a crack
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // breathy body: lowpassed noise with a gentle (non-percussive) attack
      // and a filter swell up-then-settle, like fabric filling with air
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(280, t);
      lp.frequency.linearRampToValueAtTime(950, t + 0.09);
      lp.frequency.linearRampToValueAtTime(520, t + 0.38);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.06); // soft swell in, no click
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.24);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.46);
      src.connect(lp).connect(g).connect(this.master);
      src.start(t); src.stop(t + 0.5);
      // a gentle low "whumpf" underneath for the sense of it catching air
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.3);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.11, t + 0.05);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(og).connect(this.master);
      o.start(t); o.stop(t + 0.42);
    }

    close() {  // soft whump as it collapses
      if (!this.ctx) return;
      this._noiseBurst(0.12, 0.08, 'lowpass', 700);
    }

    squawk(high) { // comic bird squawk; high = the small fast bird
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const base = high ? 680 : 360;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.8, t);
      o.frequency.linearRampToValueAtTime(base * 1.4, t + 0.05);
      o.frequency.linearRampToValueAtTime(base * 0.6, t + 0.17);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = high ? 40 : 26;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = base * 0.14;
      lfo.connect(lfoG).connect(o.frequency);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = base * 1.5; bp.Q.value = 3;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(high ? 0.12 : 0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.23);
      lfo.start(t); lfo.stop(t + 0.23);
    }

    whoosh() { // punching through the cloud deck
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t); src.stop(t + 0.7);
    }

    smash() { // through the road: a crunch and a deep slam
      if (!this.ctx) return;
      this._noiseBurst(0.5, 0.42, 'lowpass', 1400);
      this._noiseBurst(0.18, 0.3, 'highpass', 1800);
      this._tone('sine', 110, 28, 0.7, 0.4);
      this._tone('triangle', 70, 24, 0.5, 0.22, 0.03);
    }

    rumble() { // into the lava: a long low shudder
      if (!this.ctx) return;
      this._noiseBurst(1.4, 0.22, 'lowpass', 220);
      this._tone('sine', 60, 38, 1.4, 0.3);
    }

    boom() { // grenade blast: a low thump + a burst of noise
      if (!this.ctx) return;
      this._noiseBurst(0.4, 0.34, 'lowpass', 900);
      this._tone('sine', 160, 34, 0.5, 0.34);
      this._tone('triangle', 90, 30, 0.4, 0.2, 0.02);
    }

    screech() { // a wobbly falling scream as you go
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(270, t + 0.42);
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 14;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 60;
      lfo.connect(lfoG).connect(o.frequency);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
      g.gain.setValueAtTime(0.15, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.52);
      lfo.start(t); lfo.stop(t + 0.52);
    }

    phew() { // relieved exhale on a near-miss
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.6;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.linearRampToValueAtTime(1150, t + 0.09);
      bp.frequency.linearRampToValueAtTime(480, t + 0.28);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.15, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t); src.stop(t + 0.34);
    }

    chaching(big) { // cash pickup: a bright two-note register ding
      if (!this.ctx) return;
      const f = big ? 1046 : 880;
      this._tone('sine', f, f, 0.09, 0.11);
      this._tone('sine', f * 1.5, f * 1.5, 0.16, 0.09, 0.06);
    }

    payday() { // caught him: a little triumphant arpeggio + sparkle
      if (!this.ctx) return;
      [523, 659, 784, 1046].forEach((n, i) => this._tone('triangle', n, n, 0.2, 0.11, i * 0.06));
      this._noiseBurst(0.28, 0.05, 'highpass', 3000);
    }

    chime() {  // near-miss reward
      if (!this.ctx) return;
      this._tone('sine', 880, 880, 0.12, 0.10);
      this._tone('sine', 1318, 1318, 0.18, 0.09, 0.07);
    }

    sputter() { // chute ran dry
      if (!this.ctx) return;
      this._tone('square', 220, 140, 0.09, 0.06);
      this._tone('square', 180, 110, 0.09, 0.06, 0.11);
    }

    crash() {
      if (!this.ctx) return;
      this._noiseBurst(0.3, 0.3, 'lowpass', 500);
      this._tone('sine', 130, 35, 0.42, 0.3);
    }

    squelch() { // wet splat: filtered-noise "sshlp" + gloopy pitch-drop + thud
      if (!this.ctx) return;
      const t = this.ctx.currentTime;

      // wet body: bandpass noise sweeping up then down
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + 0.05);
      bp.frequency.exponentialRampToValueAtTime(180, t + 0.28);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
      ng.gain.exponentialRampToValueAtTime(0.02, t + 0.16);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      src.connect(bp).connect(ng).connect(this.master);
      src.start(t); src.stop(t + 0.34);

      // gloopy pitch drop with vibrato = the wet inner "body"
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.22);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.26, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 22;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 40;
      lfo.connect(lfoG).connect(o.frequency);
      o.connect(og).connect(this.master);
      o.start(t); o.stop(t + 0.24);
      lfo.start(t); lfo.stop(t + 0.24);

      // low thud underneath for impact weight
      this._tone('sine', 120, 40, 0.2, 0.3);
    }
  }

  window.SFX = new SFX();
})();
