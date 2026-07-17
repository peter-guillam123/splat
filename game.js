// Parachute — a little dude falls forever; hold to open the chute.
// World is a fixed-width, infinitely tall column. Camera follows the dude down.

const W = 900;
const H = 1600;

const CFG = {
  gravity: 2200,
  terminalVy: 900,       // freefall cap
  chuteVy: 170,          // descent speed the open chute eases you toward
  snapImpulse: 480,      // instant upward kick on deploy
  snapLiftCap: -300,     // fastest upward speed the kick can give you
  steerAccelOpen: 1300,
  steerAccelFree: 560,
  maxVxOpen: 340,
  maxVxFree: 300,
  juiceMax: 100,
  juiceDrain: 30,        // per second while open
  juiceRefill: 10,       // per second while closed
  juiceNearMiss: 20,
  nearMissDist: 46,      // px from girder edge that counts as a graze
  rowGapStart: 260,      // gap width, shrinks with depth
  rowGapMin: 132,
  rowIntervalStart: 430, // vertical px between girder rows
  rowIntervalMin: 290,
  metresPerPx: 1 / 100,
};

// Sky bands the fall cycles through: day → sunset → night → dawn → day…
const SKY_BANDS = [
  { sky: [0x6d, 0xb3, 0xe8], horizon: [0xd8, 0xee, 0xfb], night: 0 },   // day
  { sky: [0x9a, 0x6f, 0xa8], horizon: [0xf7, 0xb8, 0x78], night: 0 },   // sunset
  { sky: [0x1c, 0x21, 0x40], horizon: [0x4a, 0x5a, 0x8a], night: 1 },   // night
  { sky: [0x5a, 0x7a, 0xb0], horizon: [0xf2, 0xd5, 0xa8], night: 0.2 }, // dawn
];
const BAND_PX = 7000;

const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';

class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  preload() {
    // SVGs rasterised at 2x, drawn at half scale, so they stay crisp when
    // the canvas is upscaled on retina screens.
    this.load.svg('dude-fall', 'assets/dude-fall.svg', { width: 192, height: 256 });
    this.load.svg('dude-hang', 'assets/dude-hang.svg', { width: 192, height: 256 });
    this.load.svg('hair', 'assets/hair.svg', { width: 180, height: 200 });
    this.load.svg('chute', 'assets/chute.svg', { width: 480, height: 240 });
    this.load.svg('girder', 'assets/girder.svg', { width: 256, height: 80 });
    this.load.svg('cloud-1', 'assets/cloud-1.svg', { width: 360, height: 160 });
    this.load.svg('cloud-2', 'assets/cloud-2.svg', { width: 240, height: 112 });
    this.load.svg('cloud-3', 'assets/cloud-3.svg', { width: 160, height: 72 });
  }

  create() {
    this.reducedMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.state = 'ready';
    this.startY = 300;
    this.chuteOpen = false;
    this.juice = CFG.juiceMax;
    this.rows = [];
    this.clouds = [];
    this.nextRowY = this.startY + H * 1.35;
    this.prevGapC = W / 2;
    this.best = parseInt(localStorage.getItem('parachute.best') || '0', 10);

    this.cameras.main.setBounds(0, -2000, W, 4e9);

    this.buildGeneratedTextures();
    this.buildSky();
    this.buildDude();
    this.buildUI();
    this.buildInput();

    this.girders = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.collider(this.dude, this.girders, () => this.die());

    for (let i = 0; i < 5; i++) this.spawnCloud(true);

    this.cameras.main.startFollow(this.dude, false, 1, 0.15);
    this.cameras.main.setFollowOffset(0, -H * 0.17);
  }

  // ---------- construction ----------

  buildGeneratedTextures() {
    if (!this.textures.exists('puff')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 0.5); g.fillCircle(16, 16, 16);
      g.fillStyle(0xffffff, 0.8); g.fillCircle(16, 16, 10);
      g.generateTexture('puff', 32, 32);
      g.destroy();
    }
    if (!this.textures.exists('glow')) {
      // vertical gradient, transparent top → solid bottom, tinted at runtime
      const c = this.textures.createCanvas('glow', 16, 256);
      const ctx = c.getContext();
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      // eased stops; the image spans the full screen so its top edge (where
      // alpha is exactly 0) never shows as a seam
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.03)');
      grad.addColorStop(0.72, 'rgba(255,255,255,0.2)');
      grad.addColorStop(1, 'rgba(255,255,255,0.6)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 256);
      c.refresh();
    }
  }

  buildSky() {
    this.glow = this.add.image(W / 2, H, 'glow')
      .setOrigin(0.5, 1).setDisplaySize(W, H)
      .setScrollFactor(0).setDepth(0.5);

    this.stars = [];
    for (let i = 0; i < 46; i++) {
      const s = this.add.image(
        Phaser.Math.Between(10, W - 10),
        Phaser.Math.Between(10, H * 0.8),
        'puff'
      ).setScale(Phaser.Math.FloatBetween(0.05, 0.12))
        .setScrollFactor(0).setDepth(0.4).setAlpha(0);
      s.twinkle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.stars.push(s);
    }
  }

  buildDude() {
    this.hair = this.add.image(0, 0, 'hair').setOrigin(0.5, 0.96)
      .setScale(0.5).setDepth(9);
    this.hairSpring = { cur: 0.5, v: 0 };

    this.dude = this.physics.add.sprite(W / 2, this.startY, 'dude-fall')
      .setScale(0.5).setDepth(10);
    // body covers the torso+head, forgiving at the limbs (frame is 192x256)
    this.dude.body.setSize(88, 160).setOffset(52, 50);
    this.dude.body.allowGravity = false; // off until the run starts
    this.dude.setMaxVelocity(CFG.maxVxFree, CFG.terminalVy);

    this.chute = this.add.image(W / 2, 0, 'chute').setOrigin(0.5, 1)
      .setScale(0.5).setDepth(8).setVisible(false);
    this.lines = this.add.graphics().setDepth(8);

    this.puffs = this.add.particles(0, 0, 'puff', {
      speed: { min: 60, max: 180 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 420,
      emitting: false,
    }).setDepth(11);
  }

  buildUI() {
    const ui = (o) => o.setScrollFactor(0).setDepth(100);

    this.juiceBar = ui(this.add.graphics());

    this.depthText = ui(this.add.text(W - 24, 18, '0 m', {
      fontFamily: FONT, fontSize: '34px', fontStyle: '800', color: '#ffffff',
    }).setOrigin(1, 0).setShadow(0, 2, 'rgba(0,0,0,0.25)', 4));

    this.bestText = ui(this.add.text(W - 24, 58, this.best ? `best ${this.best} m` : '', {
      fontFamily: FONT, fontSize: '20px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(1, 0).setAlpha(0.75).setShadow(0, 1, 'rgba(0,0,0,0.25)', 3));

    this.muteBtn = ui(this.add.text(24, 18, SFX.muted ? '\u{1F507}' : '\u{1F50A}', {
      fontFamily: FONT, fontSize: '30px',
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
    this.muteBtn.input.hitArea.setSize(56, 56);
    this.muteBtn.on('pointerdown', (p, x, y, event) => {
      SFX.ensure();
      SFX.setMuted(!SFX.muted);
      this.muteBtn.setText(SFX.muted ? '\u{1F507}' : '\u{1F50A}');
      event.stopPropagation();
    });

    // ---- title overlay ----
    this.titleGroup = this.add.container(0, 0).setScrollFactor(0).setDepth(110);
    const title = this.add.text(W / 2, H * 0.16, 'PARACHUTE', {
      fontFamily: FONT, fontSize: '86px', fontStyle: '800', color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 4, 'rgba(0,0,0,0.28)', 10).setLetterSpacing(10);
    const sub1 = this.add.text(W / 2, H * 0.16 + 72, 'hold to open your chute', {
      fontFamily: FONT, fontSize: '30px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.95).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    const sub2 = this.add.text(W / 2, H * 0.16 + 110, 'let go to drop · steer with arrows or your finger', {
      fontFamily: FONT, fontSize: '24px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.8).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    const hint = this.add.text(W / 2, H * 0.72, 'tap anywhere to fall', {
      fontFamily: FONT, fontSize: '28px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    this.titleGroup.add([title, sub1, sub2, hint]);
    if (!this.reducedMotion) {
      this.tweens.add({ targets: hint, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
      this.tweens.add({ targets: title, y: '+=10', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    this.overGroup = null; // built on death
  }

  buildInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('A,D,W,SPACE,R');

    this.input.on('pointerdown', () => {
      SFX.ensure();
      if (this.state === 'ready') this.startRun();
      else if (this.state === 'dead' && this.canRestart) this.scene.restart();
    });
    this.input.keyboard.on('keydown', (e) => {
      SFX.ensure();
      if (this.state === 'ready') this.startRun();
      else if (this.state === 'dead' && this.canRestart && (e.key === 'r' || e.key === ' ')) {
        this.scene.restart();
      }
    });
  }

  startRun() {
    this.state = 'playing';
    this.dude.body.allowGravity = true;
    this.tweens.add({ targets: this.titleGroup, alpha: 0, duration: 350, onComplete: () => this.titleGroup.setVisible(false) });
  }

  // ---------- girder rows ----------

  spawnRow(y) {
    const depth = Math.max(0, y - this.startY);
    const gapW = Phaser.Math.Linear(CFG.rowGapStart, CFG.rowGapMin, Math.min(depth / 40000, 1));
    const margin = 80 + gapW / 2;
    // early rows keep the gap near the middle; later ones wander further
    const wander = Math.round(Phaser.Math.Linear(180, 300, Math.min(depth / 15000, 1)));
    const gapC = Phaser.Math.Clamp(
      this.prevGapC + Phaser.Math.Between(-wander, wander), margin, W - margin);
    this.prevGapC = gapC;

    const gapL = gapC - gapW / 2;
    const gapR = gapC + gapW / 2;

    // Each girder is a full screen-width tile hanging off its gap edge, so
    // moving rows can slide without resizing (the overhang stays offscreen).
    const l = this.add.tileSprite(gapL - W, y, W, 40, 'girder').setOrigin(0, 0.5).setDepth(5);
    const r = this.add.tileSprite(gapR, y, W, 40, 'girder').setOrigin(0, 0.5).setDepth(5);
    l.setTileScale(0.5); r.setTileScale(0.5);
    this.girders.add(l); this.girders.add(r);
    l.body.setImmovable(true); r.body.setImmovable(true);
    l.body.allowGravity = false; r.body.allowGravity = false;

    const moving = depth > 12000 && Math.random() < 0.35;
    const speed = moving ? Phaser.Math.Between(50, 110) * (Math.random() < 0.5 ? 1 : -1) : 0;
    if (speed) { l.body.setVelocityX(speed); r.body.setVelocityX(speed); }

    this.rows.push({ l, r, y, gapW, speed, passed: false });
  }

  updateRows(dt) {
    const cam = this.cameras.main;
    while (this.nextRowY < cam.scrollY + H * 2) {
      this.spawnRow(this.nextRowY);
      const depth = this.nextRowY - this.startY;
      const interval = Phaser.Math.Linear(
        CFG.rowIntervalStart, CFG.rowIntervalMin, Math.min(depth / 30000, 1));
      this.nextRowY += interval * Phaser.Math.FloatBetween(0.85, 1.15);
    }

    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];

      if (row.speed) {
        const centre = row.r.x - row.gapW / 2; // r.x is the gap's right edge
        if (centre - row.gapW / 2 < 90 && row.speed < 0) {
          row.speed = -row.speed;
          row.l.body.setVelocityX(row.speed); row.r.body.setVelocityX(row.speed);
        } else if (centre + row.gapW / 2 > W - 90 && row.speed > 0) {
          row.speed = -row.speed;
          row.l.body.setVelocityX(row.speed); row.r.body.setVelocityX(row.speed);
        }
      }

      // near-miss check once the dude is fully past the row
      if (!row.passed && this.state === 'playing' && this.dude.body.top > row.y + 24) {
        row.passed = true;
        const gapLNow = row.l.x + W;
        const gapRNow = row.r.x;
        const clearance = Math.min(
          this.dude.body.left - gapLNow, gapRNow - this.dude.body.right);
        if (clearance >= 0 && clearance < CFG.nearMissDist) this.nearMiss();
      }

      if (row.y < cam.scrollY - 120) {
        row.l.destroy(); row.r.destroy();
        this.rows.splice(i, 1);
      }
    }
  }

  nearMiss() {
    this.juice = Math.min(CFG.juiceMax, this.juice + CFG.juiceNearMiss);
    SFX.chime();
    if (!this.reducedMotion) this.cameras.main.shake(70, 0.0025);
    const t = this.add.text(this.dude.x, this.dude.y - 60, '+chute', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '800', color: '#ffd166',
    }).setOrigin(0.5).setDepth(50).setShadow(0, 2, 'rgba(0,0,0,0.3)', 4);
    this.tweens.add({
      targets: t, y: t.y - 70, alpha: 0, duration: 700, ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  // ---------- clouds ----------

  spawnCloud(anywhere) {
    const key = Phaser.Utils.Array.GetRandom(['cloud-1', 'cloud-2', 'cloud-3']);
    const sf = key === 'cloud-3' ? 0.35 : (key === 'cloud-2' ? 0.55 : 0.75);
    const cam = this.cameras.main;
    const screenY = anywhere ? Phaser.Math.Between(0, H) : H + 120;
    const c = this.add.image(
      Phaser.Math.Between(40, W - 40),
      cam.scrollY * sf + screenY,
      key
    ).setScrollFactor(sf).setDepth(sf < 0.5 ? 1 : 2)
      .setAlpha(sf < 0.5 ? 0.75 : 0.95)
      .setScale(Phaser.Math.FloatBetween(0.8, 1.25));
    c.sf = sf;
    this.clouds.push(c);
  }

  updateClouds() {
    const cam = this.cameras.main;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      const screenY = c.y - cam.scrollY * c.sf;
      if (screenY < -160) { c.destroy(); this.clouds.splice(i, 1); }
    }
    while (this.clouds.length < 6) this.spawnCloud(false);
  }

  // ---------- sky ----------

  updateSky(depth) {
    const pos = (depth / BAND_PX) % SKY_BANDS.length;
    const i = Math.floor(pos) % SKY_BANDS.length;
    const j = (i + 1) % SKY_BANDS.length;
    const f = pos - Math.floor(pos);
    const lerp = (a, b) => Math.round(Phaser.Math.Linear(a, b, f));
    const A = SKY_BANDS[i], B = SKY_BANDS[j];

    const sky = Phaser.Display.Color.GetColor(
      lerp(A.sky[0], B.sky[0]), lerp(A.sky[1], B.sky[1]), lerp(A.sky[2], B.sky[2]));
    const hor = Phaser.Display.Color.GetColor(
      lerp(A.horizon[0], B.horizon[0]), lerp(A.horizon[1], B.horizon[1]), lerp(A.horizon[2], B.horizon[2]));
    this.cameras.main.setBackgroundColor(sky);
    this.glow.setTint(hor);

    const night = Phaser.Math.Linear(A.night, B.night, f);
    const t = this.time.now;
    for (const s of this.stars) {
      s.setAlpha(night * (0.5 + 0.5 * Math.sin(t / 900 + s.twinkle)));
    }

    // dim the scenery as night falls so girders and clouds sit in the scene
    const dim = Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(255, 158, night)),
      Math.round(Phaser.Math.Linear(255, 170, night)),
      Math.round(Phaser.Math.Linear(255, 205, night)));
    for (const row of this.rows) { row.l.setTint(dim); row.r.setTint(dim); }
    for (const c of this.clouds) c.setTint(dim);
  }

  // ---------- chute ----------

  deploy() {
    this.chuteOpen = true;
    this.dude.setTexture('dude-hang');
    this.dude.setMaxVelocity(CFG.maxVxOpen, CFG.terminalVy);
    this.dude.setVelocityY(Math.max(this.dude.body.velocity.y - CFG.snapImpulse, CFG.snapLiftCap));

    this.chute.setVisible(true);
    this.chute.setScale(0.06, 0.03);
    this.tweens.add({ targets: this.chute, scaleX: 0.5, duration: 210, ease: 'Back.out' });
    this.tweens.add({ targets: this.chute, scaleY: 0.5, duration: 170, ease: 'Cubic.out' });

    // hair whips upward on the jolt
    this.hairSpring.v += 2.2;

    if (!this.reducedMotion) {
      this.cameras.main.shake(80, 0.003);
      this.tweens.add({ targets: this.dude, scaleY: 0.44, scaleX: 0.55, duration: 90, yoyo: true });
    }
    this.puffs.explode(10, this.dude.x, this.dude.y - 90);
    SFX.snap();
  }

  closeChute(ranDry) {
    this.chuteOpen = false;
    this.dude.setTexture('dude-fall');
    this.dude.setMaxVelocity(CFG.maxVxFree, CFG.terminalVy);
    this.tweens.add({
      targets: this.chute, scaleX: 0.05, scaleY: 0.03, duration: 110, ease: 'Cubic.in',
      onComplete: () => this.chute.setVisible(false),
    });
    this.lines.clear();
    if (ranDry) SFX.sputter(); else SFX.close();
  }

  drawChute(t) {
    if (!this.chute.visible) { this.lines.clear(); return; }
    const vx = this.dude.body.velocity.x;

    this.chute.x = this.dude.x - vx * 0.06;
    this.chute.y = this.dude.y - 104;
    this.chute.rotation = -(vx / CFG.maxVxOpen) * 0.18 + Math.sin(t / 500) * 0.03;

    // suspension lines: canopy hem → fists, live so they stretch with the snap
    this.lines.clear();
    this.lines.lineStyle(2.5, 0xd9c9a8, 0.9);
    // hem points in texture px (480x240 texture, origin bottom-centre)
    const hem = [[-216, -4], [-80, -16], [80, -16], [216, -4]];
    const fists = [[-27, -51], [27, -49]];
    const cos = Math.cos(this.chute.rotation), sin = Math.sin(this.chute.rotation);
    for (let k = 0; k < 4; k++) {
      const lx = hem[k][0] * this.chute.scaleX, ly = hem[k][1] * this.chute.scaleY;
      const px = this.chute.x + lx * cos - ly * sin;
      const py = this.chute.y + lx * sin + ly * cos;
      const f = fists[k < 2 ? 0 : 1];
      this.lines.lineBetween(px, py, this.dude.x + f[0], this.dude.y + f[1]);
    }
  }

  // ---------- death / UI ----------

  die() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.canRestart = false;

    const metres = Math.max(0, Math.floor((this.dude.y - this.startY) * CFG.metresPerPx));
    const isBest = metres > this.best;
    if (isBest) {
      this.best = metres;
      localStorage.setItem('parachute.best', String(metres));
    }

    SFX.crash();
    SFX.wind(0);
    if (!this.reducedMotion) this.cameras.main.shake(220, 0.008);
    this.puffs.explode(16, this.dude.x, this.dude.y);

    if (this.chuteOpen) this.closeChute(false);
    this.dude.setAngularVelocity(Phaser.Math.Between(0, 1) ? 260 : -260);
    this.dude.setVelocityY(Math.min(this.dude.body.velocity.y, 200));
    this.cameras.main.stopFollow();

    this.time.delayedCall(650, () => {
      this.canRestart = true;
      this.showGameOver(metres, isBest);
    });
  }

  showGameOver(metres, isBest) {
    const g = this.add.container(0, 0).setScrollFactor(0).setDepth(120).setAlpha(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a2238, 0.82);
    panel.fillRoundedRect(W / 2 - 260, H * 0.30, 520, 300, 28);
    const t1 = this.add.text(W / 2, H * 0.30 + 70, 'splat.', {
      fontFamily: FONT, fontSize: '64px', fontStyle: '800', color: '#ffffff',
    }).setOrigin(0.5);
    const t2 = this.add.text(W / 2, H * 0.30 + 150, `you fell ${metres} m`, {
      fontFamily: FONT, fontSize: '34px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(0.5);
    const t3 = this.add.text(W / 2, H * 0.30 + 200,
      isBest ? 'new best!' : `best ${this.best} m`, {
        fontFamily: FONT, fontSize: '26px', fontStyle: '600',
        color: isBest ? '#ffd166' : '#ffffff',
      }).setOrigin(0.5).setAlpha(isBest ? 1 : 0.7);
    const t4 = this.add.text(W / 2, H * 0.30 + 252, 'tap to go again', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.9);
    g.add([panel, t1, t2, t3, t4]);
    this.tweens.add({ targets: g, alpha: 1, duration: 250 });
    this.overGroup = g;
  }

  drawJuice() {
    const g = this.juiceBar;
    g.clear();
    const bw = 320, bh = 18, bx = W / 2 - bw / 2, by = 24;
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(bx - 3, by - 3, bw + 6, bh + 6, 11);
    const frac = this.juice / CFG.juiceMax;
    const low = frac < 0.25;
    let alpha = 1;
    if (this.juice <= 0.01) {
      alpha = 0.5 + 0.5 * Math.sin(this.time.now / 90); // empty: flash
    }
    if (frac > 0.001) {
      g.fillStyle(low ? 0xe8543f : 0xf2a03e, alpha);
      g.fillRoundedRect(bx, by, Math.max(bw * frac, bh), bh, 9);
    }
  }

  // ---------- main loop ----------

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);

    if (this.state === 'ready') {
      this.dude.y = this.startY + Math.sin(time / 600) * 10;
      this.positionHair(time, 0.35);
      this.updateClouds();
      this.updateSky(0);
      this.drawJuice();
      return;
    }

    const body = this.dude.body;
    const vy = body.velocity.y;
    const speed01 = Phaser.Math.Clamp(vy / CFG.terminalVy, 0, 1);

    if (this.state === 'playing') {
      // --- steering ---
      const left = this.cursors.left.isDown || this.keys.A.isDown;
      const right = this.cursors.right.isDown || this.keys.D.isDown;
      const accel = this.chuteOpen ? CFG.steerAccelOpen : CFG.steerAccelFree;
      let ax = 0;
      if (left) ax = -accel;
      else if (right) ax = accel;
      else if (this.input.activePointer.isDown) {
        const dx = this.input.activePointer.worldX - this.dude.x;
        ax = Phaser.Math.Clamp(dx * 9, -accel, accel);
      }
      body.setAccelerationX(ax);
      if (!ax) body.setVelocityX(body.velocity.x * Math.exp(-3 * dt)); // gentle air drag

      // keep him on screen
      if (this.dude.x < 40) { this.dude.x = 40; if (body.velocity.x < 0) body.setVelocityX(0); }
      if (this.dude.x > W - 40) { this.dude.x = W - 40; if (body.velocity.x > 0) body.setVelocityX(0); }

      // --- chute ---
      const holding = this.keys.SPACE.isDown || this.keys.W.isDown
        || this.cursors.up.isDown || this.input.activePointer.isDown;
      if (!holding) this.mustRelease = false; // ran dry: require a fresh press
      const wantOpen = holding && !this.mustRelease && this.juice > 2;
      if (wantOpen && !this.chuteOpen) this.deploy();
      else if (!holding && this.chuteOpen) this.closeChute(false);

      if (this.chuteOpen) {
        this.juice = Math.max(0, this.juice - CFG.juiceDrain * dt);
        if (this.juice <= 0) { this.mustRelease = true; this.closeChute(true); }
        else if (vy > CFG.chuteVy) {
          // ease toward the chute's slow descent speed
          body.setVelocityY(vy + (CFG.chuteVy - vy) * (1 - Math.exp(-5 * dt)));
        }
      } else {
        this.juice = Math.min(CFG.juiceMax, this.juice + CFG.juiceRefill * dt);
      }

      // gentle body tilt with horizontal speed
      this.dude.rotation = (body.velocity.x / CFG.maxVxOpen) * 0.14;

      this.updateRows(dt);
      this.depthText.setText(`${Math.max(0, Math.floor((this.dude.y - this.startY) * CFG.metresPerPx))} m`);
      SFX.wind(this.chuteOpen ? speed01 * 0.4 : speed01);
    }

    this.positionHair(time, 0.28 + 0.8 * speed01, dt);
    this.drawChute(time);
    this.updateClouds();
    this.updateSky(Math.max(0, this.dude.y - this.startY));
    this.drawJuice();
  }

  positionHair(time, targetStream, dt = 1 / 60) {
    // under-damped spring so the hair overshoots and settles — the whip
    const s = this.hairSpring;
    s.v += (targetStream - s.cur) * 90 * dt;
    s.v *= Math.exp(-10 * dt);
    s.cur += s.v * dt;
    s.cur = Phaser.Math.Clamp(s.cur, 0.15, 1.5);

    this.hair.x = this.dude.x - Math.sin(this.dude.rotation) * 38;
    this.hair.y = this.dude.y - 38 * Math.cos(this.dude.rotation);
    this.hair.setScale(0.5, 0.5 * s.cur);
    this.hair.rotation = this.dude.rotation
      - (this.dude.body ? this.dude.body.velocity.x : 0) / CFG.maxVxOpen * 0.3
      + Math.sin(time / 300) * 0.05;
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#6db3e8',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: CFG.gravity } },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: PlayScene,
});
