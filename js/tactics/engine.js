/*
 * Taktiktavla – animationsmotor (ingen DOM här).
 *
 * Tiden `t` räknas i frames: 0 = frame 1, 1 = frame 2, 1.5 = halvvägs mellan 2 och 3.
 * Motorn sköter play/pause/restart/steg och talar om var allt ska vara just nu
 * via `state()`. Rendering sker utanför, i onUpdate.
 */
(function () {
  const M = window.TacticsModel;
  const HOLD = 0.14; // andel av varje övergång som spelarna står still innan de rör sig

  class TacticsEngine {
    constructor({ onUpdate } = {}) {
      this.onUpdate = onUpdate || (() => {});
      this.scenario = null;
      this.t = 0;
      this.playing = false;
      this._raf = null;
      this._last = null;
      this._tick = this._tick.bind(this);
    }

    load(scenario, frameIndex = 0) {
      this.pause();
      this.scenario = scenario;
      this.t = M.clamp(frameIndex, 0, this.lastIndex);
      this._emit();
    }

    get lastIndex() { return this.scenario ? this.scenario.frames.length - 1 : 0; }
    get frameIndex() { return Math.round(this.t); }
    get atKeyframe() { return Math.abs(this.t - Math.round(this.t)) < 1e-6; }

    play() {
      if (!this.scenario || this.lastIndex === 0) return;
      if (this.t >= this.lastIndex) this.t = 0;
      this.playing = true;
      this._last = null;
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(this._tick);
      this._emit();
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      cancelAnimationFrame(this._raf);
      this._emit();
    }

    toggle() { this.playing ? this.pause() : this.play(); }

    restart() {
      this.pause();
      this.t = 0;
      this.play();
    }

    /** Hoppa till en frame (avbryter uppspelning). */
    seek(index) {
      this.pause();
      this.t = M.clamp(index, 0, this.lastIndex);
      this._emit();
    }

    /** Ett steg framåt/bakåt till närmaste hela frame. */
    step(dir) {
      const target = dir > 0 ? Math.floor(this.t + 1e-6) + 1 : Math.ceil(this.t - 1e-6) - 1;
      this.seek(target);
    }

    /** Läget just nu: { index, progress, positions, ball } */
    state() {
      const s = this.scenario;
      const i = Math.min(Math.floor(this.t + 1e-6), this.lastIndex);
      const raw = this.t - i;
      if (raw < 1e-6) return { index: i, progress: 0, ...M.frameState(s, i) };
      const p = raw <= HOLD ? 0 : (raw - HOLD) / (1 - HOLD);
      return { index: i, progress: raw, ...M.interpolate(s, i, M.easeInOut(p)) };
    }

    _tick(ts) {
      if (!this.playing) return;
      if (this._last == null) this._last = ts;
      const dt = Math.min(0.1, (ts - this._last) / 1000); // tål flikbyte/hack
      this._last = ts;
      const i = Math.min(Math.floor(this.t), this.lastIndex);
      const duration = (this.scenario.frames[i].duration || M.DEFAULT_DURATION) / (this.scenario.speed || 1);
      this.t += dt / duration;
      if (this.t >= this.lastIndex) {
        this.t = this.lastIndex;
        this.playing = false;
        this._emit();
        return;
      }
      this._emit();
      this._raf = requestAnimationFrame(this._tick);
    }

    _emit() { this.onUpdate(this); }
  }

  window.TacticsEngine = TacticsEngine;
})();
