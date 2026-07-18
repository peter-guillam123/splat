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

    snap() {   // canopy cracks open
      if (!this.ctx) return;
      this._noiseBurst(0.18, 0.28, 'highpass', 900);
      this._tone('triangle', 110, 55, 0.16, 0.22);
    }

    close() {  // soft whump as it collapses
      if (!this.ctx) return;
      this._noiseBurst(0.12, 0.08, 'lowpass', 700);
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
