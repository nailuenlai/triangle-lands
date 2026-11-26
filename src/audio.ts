/**
 * Procedural Web Audio nature soundscape & gentle interactive audio.
 * Zero external assets: synthesizes breeze, rustling leaves, shore waves,
 * spatial woodland birdsong, sparse ambient harmonics, and soft SFX.
 */

import { BIOMES } from './biomes';

export interface AudioEnv {
  altitude: number;
  waterProximity: number; // 0 (far from water) .. 1 (at/in water)
  swimming: boolean;
  speed: number;          // 0 .. 1 normalized movement speed
  grounded: boolean;
  onStone: boolean;
  aerial: boolean;        // true during high-altitude vista / resonance camera
  glide: number;          // 0 .. 1 paraglider airspeed (0 when not gliding)
  climbing: boolean;
  biomeIndex?: number;    // 0..5 current region
  nightFactor?: number;   // 0..1 night blend
}

// D major pentatonic fallback frequencies for calm, open-air ambient tones
const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99];
const BASS = [146.83, 196.0, 220.0];

export class NatureAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private breezeFilter!: BiquadFilterNode;
  private breezeGain!: GainNode;
  private leavesFilter!: BiquadFilterNode;
  private leavesGain!: GainNode;
  private waterFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private momentGain!: GainNode;
  private momentOscA!: OscillatorNode;
  private momentOscB!: OscillatorNode;
  private noiseBuf!: AudioBuffer;

  private started = false;
  private _muted = false;
  private t = 0;
  private birdTimer = 2.5;
  private noteTimer = 5.5;
  private stepDist = 0;

  constructor(initialMuted = false) {
    this._muted = initialMuted;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.ctx.suspend().catch(() => {});
      } else if (this.started && !this._muted) {
        this.ctx.resume().catch(() => {});
      }
    });
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Call inside a user gesture (click / touch / keydown) to unlock & start audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.setupGraph(this.ctx);
    }
    this.started = true;
    if (!this._muted && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._muted ? 0 : 0.8, now, 0.8);
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (!this.ctx) {
      if (!this._muted) this.unlock();
      return this._muted;
    }
    const now = this.ctx.currentTime;
    if (this._muted) {
      this.master.gain.setTargetAtTime(0, now, 0.15);
    } else {
      this.unlock();
      this.master.gain.setTargetAtTime(0.8, now, 0.35);
    }
    return this._muted;
  }

  private setupGraph(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);

    this.noiseBuf = this.createSeamlessPinkNoise(ctx, 7.0);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.createOutdoorImpulse(ctx, 2.4);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    this.reverb.connect(revGain);
    revGain.connect(this.master);

    // 1. Warm valley / ridge breeze
    const breezeSrc = ctx.createBufferSource();
    breezeSrc.buffer = this.noiseBuf;
    breezeSrc.loop = true;
    this.breezeFilter = ctx.createBiquadFilter();
    this.breezeFilter.type = 'bandpass';
    this.breezeFilter.frequency.value = 320;
    this.breezeFilter.Q.value = 0.65;
    this.breezeGain = ctx.createGain();
    this.breezeGain.gain.value = 0.05;
    breezeSrc.connect(this.breezeFilter);
    this.breezeFilter.connect(this.breezeGain);
    this.breezeGain.connect(this.master);
    breezeSrc.start(0);

    // 2. Soft leaf & grass rustle
    const leavesSrc = ctx.createBufferSource();
    leavesSrc.buffer = this.noiseBuf;
    leavesSrc.loop = true;
    this.leavesFilter = ctx.createBiquadFilter();
    this.leavesFilter.type = 'bandpass';
    this.leavesFilter.frequency.value = 1100;
    this.leavesFilter.Q.value = 0.9;
    const leavesLp = ctx.createBiquadFilter();
    leavesLp.type = 'lowpass';
    leavesLp.frequency.value = 2300;
    this.leavesGain = ctx.createGain();
    this.leavesGain.gain.value = 0.014;
    leavesSrc.connect(this.leavesFilter);
    this.leavesFilter.connect(leavesLp);
    leavesLp.connect(this.leavesGain);
    this.leavesGain.connect(this.master);
    leavesSrc.start(0, 2.7);

    // 3. Gentle shore / lake water wash
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = this.noiseBuf;
    waterSrc.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass';
    this.waterFilter.frequency.value = 460;
    this.waterFilter.Q.value = 0.8;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.0;
    waterSrc.connect(this.waterFilter);
    this.waterFilter.connect(this.waterGain);
    this.waterGain.connect(this.master);
    waterSrc.start(0, 4.9);

    // 4. Ethereal fifth-harmonic shimmer pad for Temporal Moment dwell feedback
    this.momentOscA = ctx.createOscillator();
    this.momentOscB = ctx.createOscillator();
    this.momentOscA.type = 'sine';
    this.momentOscB.type = 'sine';
    this.momentOscA.frequency.value = 440;
    this.momentOscB.frequency.value = 659.25;
    this.momentGain = ctx.createGain();
    this.momentGain.gain.value = 0.0;
    this.momentOscA.connect(this.momentGain);
    this.momentOscB.connect(this.momentGain);
    this.momentGain.connect(this.reverb);
    const dryM = ctx.createGain();
    dryM.gain.value = 0.35;
    this.momentGain.connect(dryM);
    dryM.connect(this.master);
    this.momentOscA.start(0);
    this.momentOscB.start(0);
  }

  /** Paul Kellet pink noise with crossfaded loop seam so there is never a click. */
  private createSeamlessPinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.5);
    const buf = ctx.createBuffer(2, len, sr);

    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      const raw = new Float32Array(len + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      for (let i = 0; i < len; i++) {
        if (i < fade) {
          const a = i / fade;
          const ca = Math.cos((1 - a) * Math.PI * 0.5);
          const cb = Math.cos(a * Math.PI * 0.5);
          out[i] = raw[i] * ca + raw[len + i] * cb;
        } else {
          out[i] = raw[i];
        }
      }
    }
    return buf;
  }

  /** Warm, damped stereo impulse response simulating open valleys & hills. */
  private createOutdoorImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const env = Math.pow(1 - k, 2.8) * Math.min(1, i / (sr * 0.025));
        const n = Math.random() * 2 - 1;
        // Progressive high-frequency air absorption
        const alpha = 0.25 * (1 - k * 0.65);
        lp += alpha * (n - lp);
        d[i] = lp * env * 0.55;
      }
    }
    return buf;
  }

  update(dt: number, env: AudioEnv) {
    if (!this.ctx || !this.started || this._muted || this.ctx.state !== 'running') return;
    this.t += dt;
    const now = this.ctx.currentTime;
    const bioIdx = env.biomeIndex ?? 0;
    const bio = BIOMES[bioIdx] ?? BIOMES[0];
    const night = env.nightFactor ?? 0;

    // Natural irregular wind gusts modulated by biome character (brisk in Canyon/Snow, calm in Maple/Mistwood)
    const gust = 0.5 + 0.3 * Math.sin(this.t * 0.34) + 0.2 * Math.sin(this.t * 0.13 + 1.7);
    const highFactor = Math.min(1, Math.max(0, (env.altitude - 18) / 42)) + (env.aerial ? 0.55 : 0);
    const windMod = Math.max(0, 1 + bio.windBoost);
    const breezeFreq = (250 + gust * 190 + highFactor * 160 + env.speed * 70 + env.glide * 520) * (bioIdx === 5 ? 1.18 : bioIdx === 4 ? 0.82 : 1.0);
    const breezeVol = (0.042 + gust * 0.045 + highFactor * 0.04 + env.speed * 0.018 + env.glide * 0.11) * windMod;
    this.breezeFilter.frequency.setTargetAtTime(breezeFreq, now, 0.3);
    this.breezeGain.gain.setTargetAtTime(Math.min(0.26, breezeVol), now, 0.3);

    // Rustling leaves (rich in Mistwood & Maple, hushed in Canyon & high Snow)
    const treeZone = env.swimming ? 0.15 : Math.max(0.15, 1 - Math.max(0, (env.altitude - 38) / 28));
    const rustle = (0.008 + gust * 0.018) * treeZone * bio.leafFactor;
    this.leavesFilter.frequency.setTargetAtTime(920 + gust * 420, now, 0.3);
    this.leavesGain.gain.setTargetAtTime(rustle, now, 0.3);

    // Gentle shore waves when near lakes / sea / karst lagoons
    const wave = 0.5 + 0.5 * Math.sin(this.t * 0.92 + 0.35 * Math.sin(this.t * 0.27));
    const waterAmt = Math.min(1, env.waterProximity + bio.waterFactor * 0.35);
    const waterVol = waterAmt * (0.018 + wave * 0.045);
    this.waterFilter.frequency.setTargetAtTime(310 + wave * 420, now, 0.2);
    this.waterGain.gain.setTargetAtTime(waterVol, now, 0.25);

    // Soft footsteps while moving
    if (env.speed > 0.12 && (env.grounded || env.swimming || env.climbing) && !env.aerial) {
      this.stepDist += dt * env.speed * (env.swimming ? 1.4 : env.climbing ? 2.0 : 2.65);
      if (this.stepDist >= 1) {
        this.stepDist -= 1;
        this.playStep(env.swimming, env.onStone || env.climbing);
      }
    } else {
      this.stepDist = 0.65;
    }

    // Woodland birdsong (quiet at night except soft mystical dove/owl in Mistwood; rare in Snow)
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3.8 + Math.random() * 6.4;
      if (env.altitude < 56 && !env.aerial && Math.random() < bio.birdFactor * (1 - night * 0.72)) {
        this.playBird(bioIdx === 4 && night > 0.45);
      }
    }

    // Sparse open-air ambient harmonic notes tuned to current biome's musical mode
    this.noteTimer -= dt;
    if (this.noteTimer <= 0) {
      this.noteTimer = 9.5 + Math.random() * 9.5;
      this.playAmbientPhrase(bioIdx);
    }
  }

  private playStep(swimming: boolean, onStone: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const offset = Math.random() * 5.5;

    const flt = ctx.createBiquadFilter();
    const g = ctx.createGain();

    if (swimming) {
      flt.type = 'bandpass';
      flt.frequency.setValueAtTime(420 + Math.random() * 180, now);
      flt.frequency.exponentialRampToValueAtTime(760, now + 0.16);
      flt.Q.value = 1.6;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.032, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(now, offset, 0.22);
    } else if (onStone) {
      flt.type = 'bandpass';
      flt.frequency.value = 950 + Math.random() * 250;
      flt.Q.value = 1.8;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.022, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(now, offset, 0.09);
    } else {
      // Soft grass / dirt brush
      flt.type = 'bandpass';
      flt.frequency.value = 520 + Math.random() * 180;
      flt.Q.value = 1.1;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.018, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(now, offset, 0.11);
    }
  }

  private playBird(nocturnal = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = pan ?? ctx.createGain();
    if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.78;

    const dry = ctx.createGain();
    dry.gain.value = 0.55;
    out.connect(dry);
    dry.connect(this.master);
    out.connect(this.reverb);

    if (nocturnal) {
      // Soft distant woodland owl two-hoot call in Mistwood at night
      const base = 390 + Math.random() * 60;
      this.chirp(ctx, out, now, base * 1.04, base, 0.34, 0.018);
      this.chirp(ctx, out, now + 0.52, base * 0.90, base * 0.85, 0.42, 0.016);
      return;
    }

    const kind = Math.random();
    if (kind < 0.28) {
      // Warm woodland dove / cuckoo-like two-note call
      const base = 580 + Math.random() * 140;
      const notes = [
        { t: 0, f0: base * 1.02, f1: base, dur: 0.22 },
        { t: 0.3, f0: base * 0.81, f1: base * 0.79, dur: 0.28 },
      ];
      for (const n of notes) {
        this.chirp(ctx, out, now + n.t, n.f0, n.f1, n.dur, 0.022);
      }
    } else if (kind < 0.68) {
      // Sweet songbird 3-4 chirp phrase
      const count = 2 + Math.floor(Math.random() * 3);
      const base = 1950 + Math.random() * 850;
      let t = 0;
      for (let i = 0; i < count; i++) {
        const up = Math.random() > 0.35;
        const f0 = base * (0.92 + i * 0.05);
        const f1 = f0 * (up ? 1.22 : 0.84);
        const dur = 0.055 + Math.random() * 0.04;
        this.chirp(ctx, out, now + t, f0, f1, dur, 0.016);
        t += dur + 0.045 + Math.random() * 0.05;
      }
    } else {
      // Gentle double-flutter skylark note
      const base = 2400 + Math.random() * 600;
      this.chirp(ctx, out, now, base, base * 1.18, 0.065, 0.014);
      this.chirp(ctx, out, now + 0.09, base * 1.15, base * 0.94, 0.085, 0.015);
    }
  }

  private chirp(
    ctx: AudioContext, dest: AudioNode, start: number,
    f0: number, f1: number, dur: number, peak: number,
  ) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Breath-of-the-Wild style ultra-sparse felt-bell / wind-harp notes tuned per biome. */
  private playAmbientPhrase(biomeIndex = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bio = BIOMES[biomeIndex] ?? BIOMES[0];
    const scale = bio.scale.length ? bio.scale : PENTA;
    const bass = bio.bass.length ? bio.bass : BASS;
    const count = Math.random() < 0.45 ? 1 : 2;
    let idx = Math.floor(Math.random() * scale.length);

    if (Math.random() < 0.38) {
      const bf = bass[Math.floor(Math.random() * bass.length)];
      this.softTone(ctx, now, bf, 4.4, 0.026);
    }
    for (let i = 0; i < count; i++) {
      const t = now + i * (0.55 + Math.random() * 0.55);
      this.softTone(ctx, t, scale[idx], 3.8, 0.024);
      idx = Math.max(0, Math.min(scale.length - 1, idx + (Math.random() < 0.5 ? 1 : -2)));
    }
  }

  private softTone(ctx: AudioContext, start: number, freq: number, dur: number, peak: number) {
    const osc = ctx.createOscillator();
    const ov = ctx.createOscillator();
    const ovGain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    ov.type = 'triangle';
    ov.frequency.value = freq * 2;
    ovGain.gain.setValueAtTime(0.12, start);
    ovGain.gain.exponentialRampToValueAtTime(0.001, start + dur * 0.35);

    lp.type = 'lowpass';
    lp.frequency.value = 1350;

    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(lp);
    ov.connect(ovGain);
    ovGain.connect(lp);
    lp.connect(g);

    const dry = ctx.createGain();
    dry.gain.value = 0.4;
    g.connect(dry);
    dry.connect(this.master);
    g.connect(this.reverb);

    osc.start(start);
    ov.start(start);
    osc.stop(start + dur + 0.05);
    ov.stop(start + dur + 0.05);
  }

  /** Poetic regional arrival motif when stepping into a biome. */
  playRegionEnter(biomeIndex: number, isFirst: boolean) {
    const ctx = this.ready();
    if (!ctx) return;
    const bio = BIOMES[biomeIndex] ?? BIOMES[0];
    const now = ctx.currentTime;
    if (isFirst && bio.bass.length) {
      this.softTone(ctx, now, bio.bass[0], 4.2, 0.036);
    }
    bio.arrivalMotif.forEach((f, i) => {
      this.softTone(ctx, now + i * 0.24, f, 3.2, isFirst ? 0.030 : 0.020);
    });
  }

  /** Luminous discovery chord when spotting one of the six regional Wonders. */
  playWonderDiscover() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    [369.99, 440.0, 587.33, 880.0].forEach((f, i) => {
      this.softTone(ctx, now + i * 0.14, f, 3.4, 0.032);
    });
    this.bell(1174.66, 0.42, 0.026, 2.2);
  }

  /** Serene shimmering harmonic wash when silently capturing a Temporal Vista (時景). */
  playMomentCapture() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    [293.66, 440.0, 554.37, 659.25, 880.0].forEach((f, i) => {
      this.softTone(ctx, now + i * 0.18, f, 4.4, 0.028);
    });
    this.bell(1318.5, 0.55, 0.022, 2.6);
  }

  /** Soft crystalline wind-chime when spotting an ancient shrine up close. */
  playDiscover() {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.softTone(this.ctx, now, 587.33, 2.4, 0.035);       // D5
    this.softTone(this.ctx, now + 0.24, 880.0, 2.8, 0.032); // A5
  }

  /** Warm blooming harmonic resonance when awakening an ancient monolith. */
  playActivate() {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const chord = [146.83, 220.0, 329.63, 369.99, 440.0, 587.33, 739.99];
    chord.forEach((f, i) => {
      this.softTone(this.ctx!, now + i * 0.14, f, 4.6, i === 0 ? 0.048 : 0.034);
    });
  }

  /** Gentle wind-bell shimmer when rising for an aerial vista revisit. */
  playVista() {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    [440.0, 587.33, 659.25].forEach((f, i) => {
      this.softTone(this.ctx!, now + i * 0.12, f, 2.6, 0.026);
    });
  }

  /** Subtle parchment rustle on opening/closing the map. */
  playMap(opening: boolean) {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.setValueAtTime(opening ? 600 : 950, now);
    flt.frequency.exponentialRampToValueAtTime(opening ? 1100 : 520, now + 0.14);
    flt.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.035, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    src.start(now, Math.random() * 4, 0.18);
  }

  // ------------------------------------------------------------ Movement & reward SFX
  private ready(): AudioContext | null {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private noiseBurst(
    type: BiquadFilterType, f0: number, f1: number, q: number,
    peak: number, dur: number, attack = 0.01, delay = 0,
  ) {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f0, now);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(now, Math.random() * 5, dur + 0.05);
  }

  private bell(freq: number, delay: number, peak: number, dur = 1.6) {
    const ctx = this.ready();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.76; // inharmonic bell partial
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g2.gain.setValueAtTime(0.0001, start);
    g2.gain.linearRampToValueAtTime(peak * 0.35, start + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.35);
    osc.connect(g); osc2.connect(g2);
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    g.connect(dry); g2.connect(dry);
    dry.connect(this.master);
    g.connect(this.reverb); g2.connect(this.reverb);
    osc.start(start); osc2.start(start);
    osc.stop(start + dur + 0.05); osc2.stop(start + dur + 0.05);
  }

  playJump() { this.noiseBurst('bandpass', 380, 1100, 1.2, 0.05, 0.16, 0.01); }

  playGlideOpen() {
    this.noiseBurst('bandpass', 260, 700, 0.9, 0.09, 0.12, 0.005);
    this.noiseBurst('bandpass', 420, 1300, 0.9, 0.08, 0.16, 0.005, 0.07);
    this.bell(659.25, 0.02, 0.018, 0.8);
  }

  playGlideClose() { this.noiseBurst('bandpass', 900, 380, 1.0, 0.06, 0.14, 0.005); }

  playLand(impact: number) {
    const k = Math.min(1, impact / 30);
    if (k < 0.15) return;
    this.noiseBurst('lowpass', 420, 90, 0.7, 0.05 + k * 0.12, 0.18 + k * 0.2, 0.004);
  }

  playSplash(impact: number) {
    const k = Math.min(1, impact / 25);
    this.noiseBurst('bandpass', 1400, 380, 0.8, 0.06 + k * 0.1, 0.45 + k * 0.3, 0.01);
    this.noiseBurst('lowpass', 500, 120, 0.6, 0.05 + k * 0.08, 0.35, 0.005);
  }

  playGrab() { this.noiseBurst('bandpass', 1500, 700, 2.0, 0.05, 0.1, 0.004); }

  playLeap() {
    this.noiseBurst('bandpass', 700, 1600, 1.4, 0.05, 0.2, 0.01);
    this.noiseBurst('bandpass', 1300, 900, 2.0, 0.035, 0.08, 0.003);
  }

  /** Orb pick-up: rising pentatonic bell that climbs with combo chains. */
  playOrb(combo: number) {
    const idx = Math.min(PENTA.length - 1, combo % PENTA.length);
    const oct = combo >= PENTA.length ? 2 : 1;
    this.bell(PENTA[idx] * 2 * oct, 0, 0.05, 1.4);
    this.bell(PENTA[Math.min(PENTA.length - 1, idx + 2)] * 2 * oct, 0.07, 0.03, 1.2);
  }

  playRing(i: number) {
    const f = PENTA[Math.min(PENTA.length - 1, i)] * 2;
    this.bell(f, 0, 0.05, 1.3);
    this.noiseBurst('highpass', 3000, 6000, 0.7, 0.02, 0.25, 0.01);
  }

  playCourseDone() {
    [587.33, 739.99, 880, 1174.66, 1479.98].forEach((f, i) => this.bell(f, i * 0.09, 0.05, 2.2));
    const ctx = this.ready();
    if (ctx) [146.83, 220].forEach((f) => this.softTone(ctx, ctx.currentTime, f, 3.2, 0.04));
  }

  playCourseFail() {
    this.bell(440, 0, 0.03, 0.9);
    this.bell(369.99, 0.14, 0.03, 1.1);
  }

  playExhausted() {
    const ctx = this.ready();
    if (ctx) this.softTone(ctx, ctx.currentTime, 185, 1.2, 0.05);
    this.noiseBurst('bandpass', 900, 500, 1.5, 0.03, 0.35, 0.05);
  }

  playUpgrade() {
    const ctx = this.ready();
    if (!ctx) return;
    [293.66, 369.99, 440, 587.33, 739.99, 880].forEach((f, i) => this.softTone(ctx, ctx.currentTime + i * 0.07, f, 3, 0.035));
    this.bell(1760, 0.45, 0.025, 2);
  }

  playUpdraft() { this.noiseBurst('bandpass', 300, 1400, 0.8, 0.07, 0.9, 0.25); }

  /** Gently swells a serene harmonic fifth while dwelling inside a Temporal Moment (0..1). */
  updateMomentDwell(progress: number) {
    if (!this.ctx || !this.momentGain) return;
    const now = this.ctx.currentTime;
    const p = this._muted || this.ctx.state !== 'running' ? 0 : Math.max(0, Math.min(1, progress));
    const vol = p * p * 0.028;
    this.momentGain.gain.setTargetAtTime(vol, now, 0.14);
    this.momentOscA.frequency.setTargetAtTime(440 + p * 7.5, now, 0.2);
    this.momentOscB.frequency.setTargetAtTime(659.25 + p * 11.2, now, 0.2);
  }

  /** Distinct 3-note celestial shimmer replacing time-of-day text toasts. */
  playTimeShift(phase: 'morning' | 'sunset' | 'night' | 'dawn') {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chords: Record<typeof phase, number[]> = {
      morning: [440, 554.37, 659.25],
      sunset: [392, 493.88, 587.33],
      night: [587.33, 739.99, 1174.66],
      dawn: [329.63, 440, 587.33],
    };
    chords[phase].forEach((f, i) => {
      this.softTone(ctx, now + i * 0.11, f, 2.4, 0.024);
    });
    if (phase === 'night') this.bell(1318.5, 0.22, 0.016, 1.8);
  }

  /** Soft crystalline lift when stamina finishes recovering from exhaustion. */
  playRecovered() {
    this.bell(587.33, 0, 0.024, 1.1);
    this.bell(880, 0.09, 0.026, 1.4);
  }

  /** Warm singing-bowl hum when stepping onto an unactivated shrine altar. */
  playShrineProximity() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.softTone(ctx, now, 220, 2.2, 0.026);
    this.softTone(ctx, now + 0.08, 329.63, 2.0, 0.018);
  }

  /** Gentle countdown pulse in the final moments of a wind trial ring window. */
  playTrialTick(urgent: boolean) {
    this.bell(urgent ? 987.77 : 783.99, 0, urgent ? 0.026 : 0.018, 0.35);
  }

  /** Airy summit wind-chime when collecting a mountain-peak orb. */
  playPeakVista() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.softTone(ctx, now, 587.33, 3.0, 0.022);
    this.softTone(ctx, now + 0.16, 880, 3.4, 0.022);
    this.bell(1174.66, 0.3, 0.018, 2.0);
  }

  /** Whisper-soft airy prompt when the glider silhouette first appears mid-fall. */
  playGlideCue() {
    this.bell(739.99, 0, 0.018, 0.9);
    this.noiseBurst('bandpass', 500, 1200, 1.2, 0.024, 0.25, 0.02);
  }

  /** Grand warm harmonic bloom when all six shrines are resonated. */
  playAllDone() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    [146.83, 220, 293.66, 369.99, 440, 587.33, 739.99, 880].forEach((f, i) => {
      this.softTone(ctx, now + i * 0.13, f, 5.2, i < 2 ? 0.04 : 0.03);
    });
    [1174.66, 1479.98, 1760].forEach((f, i) => this.bell(f, 0.7 + i * 0.14, 0.024, 2.6));
  }
}
