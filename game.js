// Splat! — a little dude falls forever; hold to open the chute.
// World is a fixed-width, infinitely tall column. Camera follows the dude down.

const W = 900;
const H = 1600;

const CFG = {
  gravity: 2200,
  terminalVy: 900,       // freefall cap
  chuteVy: 175,          // gentle descent the chute floats you at
  snapImpulse: 1400,     // big enough that the lift cap always binds
  snapLiftCap: -360,     // guaranteed upward speed the moment it opens
  liftVel: -190,         // held upward speed during the lift window
  liftDuration: 420,     // ms of lift before it settles into the float
  chuteEase: 6,          // how fast vy is pulled to its target while open
  steerAccelOpen: 1300,
  steerAccelFree: 560,
  maxVxOpen: 340,
  maxVxFree: 300,
  juiceMax: 100,
  juiceDrain: 30,        // per second while open
  juiceRefill: 10,       // per second while closed
  juiceNearMiss: 20,
  nearMissDist: 46,      // px from girder edge that counts as a graze
  rowGapStart: 270,      // gap width, shrinks with depth
  rowGapMin: 138,
  rowUnit: 440,          // one vertical "beat"; spacing is a whole number of
                         // these, so the rhythm stays readable with movers
  moverGapBonus: 16,     // moving rows get a slightly wider gap, to stay fair
  wobbleRange: 95,       // half-range a wobbling gap drifts around its centre
  wobbleSpeed: [28, 52], // px/s for a wobbling gap
  scrollSpeed: [70, 120],// px/s for a fully scrolling gap
  depthWobble: 6000,     // wobbling gaps start easing in here (~60 m)
  depthScroll: 16000,    // fully scrolling gaps start easing in here (~160 m)
  depthBirds: 9000,      // birds start crossing here (~90 m)
  birdGapMs: [1300, 2900], // delay between birds
  birdBigChance: 0.3,    // rest are small
  birdSpeedSmall: [95, 165], // fast
  birdSpeedBig: [40, 72],    // slow
  birdNudge: 340,        // fixed sideways shove from a small bird (px/s)
  birdFluster: 380,      // ms your steering is dampened after a nudge
  metresPerPx: 1 / 100,
  // --- the robber chase ---
  robberVy: 560,         // his steady fall; freefall (900) closes, chute loses
  robberEscalate: 45,    // +vy each time you catch him
  titleGap: 1520,        // how far below he starts, and the handoff lead-in
  catchDist: 62,         // gap (px) at which you reach him
  escapeGap: 1680,       // fresh lead he bolts to after a catch
  maxGap: 3400,          // he eases off past this so the chase stays winnable
  cashDropMs: [480, 1050], // how often he sheds a note
  cashBagChance: 0.12,   // rest are notes
  cashNote: 60,          // $ per note
  cashBag: 350,          // $ per bag
  catchPayday: 1000,     // $ for catching him (grows with the chase level)
  depthTrickle: 0.02,    // $ per px fallen (you're on the case)
  holdFrac: 0.62,        // where the dude is held on screen (fraction from top)
  titleFrac: 0.5,        // where the robber sits on the title
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
    this.load.svg('bird-big-up', 'assets/bird-big-up.svg', { width: 256, height: 192 });
    this.load.svg('bird-big-down', 'assets/bird-big-down.svg', { width: 256, height: 192 });
    this.load.svg('bird-small-up', 'assets/bird-small-up.svg', { width: 160, height: 120 });
    this.load.svg('bird-small-down', 'assets/bird-small-down.svg', { width: 160, height: 120 });
    this.load.svg('robber-fall', 'assets/robber-fall.svg', { width: 192, height: 256 });
    this.load.svg('cash-note', 'assets/cash-note.svg', { width: 96, height: 56 });
    this.load.svg('cash-bag', 'assets/cash-bag.svg', { width: 88, height: 96 });
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
    this.best = parseInt(localStorage.getItem('splat.best') || '0', 10);
    this.bestCash = parseInt(localStorage.getItem('splat.bestcash') || '0', 10);
    this.cash = 0;         // headline score, in dollars
    this.chaseLevel = 0;   // rises each catch; the robber gets faster
    this.nextCashAt = 0;
    this.prevDudeY = this.startY; // for the depth-trickle score

    this.cameras.main.setBounds(0, -2000, W, 4e9);

    this.buildGeneratedTextures();
    this.buildSky();
    this.buildDude();
    this.buildUI();
    this.buildInput();

    this.girders = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.collider(this.dude, this.girders, (dude, girder) => {
      // hitting a surface top/bottom is a direct connect -> splat;
      // clipping the end of a bar is a side hit -> tumble
      const t = dude.body.touching;
      const splat = t.down || t.up;
      if (splat) {
        // rest the pancake on the surface it actually hit
        dude.y = t.down ? girder.body.top - 6 : girder.body.bottom + 6;
      }
      this.die(splat);
    });

    // ---- birds ----
    this.anims.create({ key: 'flap-big', frameRate: 5, repeat: -1,
      frames: [{ key: 'bird-big-up' }, { key: 'bird-big-down' }] });
    this.anims.create({ key: 'flap-small', frameRate: 13, repeat: -1,
      frames: [{ key: 'bird-small-up' }, { key: 'bird-small-down' }] });
    this.birdsGroup = this.physics.add.group({ allowGravity: false });
    this.nextBirdAt = 0;
    this.flusterUntil = 0;
    this.physics.add.overlap(this.dude, this.birdsGroup, (dude, bird) => this.hitBird(bird));

    this.buildRobber();

    for (let i = 0; i < 5; i++) this.spawnCloud(true);

    // The camera is driven by hand (no springy follow): the title holds the
    // robber; play holds the dude at a fixed screen height. See updateCamera.
    this.cameras.main.scrollY = this.robber.y - H * CFG.titleFrac;
  }

  buildRobber() {
    // the cash he sheds is a visual trail only — you only get paid by catching
    // HIM, not by falling through the notes
    this.cashGroup = this.physics.add.group({ allowGravity: false });

    this.robber = this.physics.add.sprite(W / 2, this.startY + CFG.titleGap, 'robber-fall')
      .setScale(0.5).setDepth(10);
    this.robber.body.allowGravity = false;
    this.robber.body.setVelocityY(CFG.robberVy);
    this.robber.body.setSize(140, 120).setOffset(26, 68); // generous "touch" area
    this.caught = false; // brief guard after a catch
    // you catch him by actually touching him now, not just reaching his depth
    this.physics.add.overlap(this.dude, this.robber, () => {
      if (this.state === 'playing' && !this.handoff && !this.caught) this.catchRobber();
    });

    // downward chevron shown when he's below the view
    this.chevron = this.add.graphics().setScrollFactor(0).setDepth(95);
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
    if (!this.textures.exists('splat-blob')) {
      // a comic splat: a messy central mass with drips flung out around it
      const g = this.make.graphics({ add: false });
      const blobs = [[64, 66, 33], [42, 54, 19], [88, 58, 20], [54, 88, 17],
        [82, 86, 14], [70, 40, 15], [40, 78, 13],
        // flung satellite drips
        [22, 38, 9], [104, 34, 8], [112, 74, 7], [16, 80, 8], [70, 20, 7],
        [30, 100, 6], [98, 100, 6], [120, 52, 5], [10, 56, 5], [58, 116, 5]];
      g.fillStyle(0x9e1327, 1); blobs.forEach(([x, y, r]) => g.fillCircle(x, y, r + 1));
      g.fillStyle(0xe0243a, 1); blobs.forEach(([x, y, r]) => g.fillCircle(x, y, Math.max(1, r - 2)));
      g.fillStyle(0xff5a70, 0.5); g.fillCircle(55, 55, 12); g.fillCircle(84, 60, 6);
      g.generateTexture('splat-blob', 128, 128);
      g.destroy();
    }
    if (!this.textures.exists('drop')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xb01530, 1); g.fillCircle(8, 8, 7);
      g.fillStyle(0xe0243a, 1); g.fillCircle(8, 8, 5);
      g.fillStyle(0xff5a70, 0.6); g.fillCircle(6, 6, 2);
      g.generateTexture('drop', 16, 16);
      g.destroy();
    }
    if (!this.textures.exists('feather')) {
      // a little curved feather (tinted per bird when it bursts)
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1);
      g.fillEllipse(9, 9, 15, 7);
      g.fillStyle(0x000000, 0.12); g.fillEllipse(9, 11, 13, 3); // soft underside
      g.fillStyle(0xffffff, 1); g.fillRect(8.2, 3, 1.6, 12);    // quill
      g.generateTexture('feather', 18, 18);
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
    this.poseBody(false); // flat-skydiver hitbox to start
    // On the title he's pinned a screen above the robber (off-frame, gravity
    // off); the first tap drops him into real physics to give chase.
    this.dude.body.allowGravity = false;
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

    // cash is the headline; depth is the quiet driver beneath it
    this.cashText = ui(this.add.text(W - 24, 14, '$0', {
      fontFamily: FONT, fontSize: '46px', fontStyle: '800', color: '#ffe08a',
    }).setOrigin(1, 0).setShadow(0, 2, 'rgba(0,0,0,0.3)', 5));

    this.depthText = ui(this.add.text(W - 24, 68, '0 m', {
      fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(1, 0).setAlpha(0.85).setShadow(0, 1, 'rgba(0,0,0,0.25)', 3));

    this.bestText = ui(this.add.text(W - 24, 98, this.bestCash ? `best $${this.bestCash.toLocaleString('en-US')}` : '', {
      fontFamily: FONT, fontSize: '18px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(1, 0).setAlpha(0.65).setShadow(0, 1, 'rgba(0,0,0,0.25)', 3));

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
    const title = this.add.text(W / 2, H * 0.16, 'SPLAT!', {
      fontFamily: FONT, fontSize: '128px', fontStyle: '800', color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 5, 'rgba(0,0,0,0.28)', 12).setLetterSpacing(6);
    const sub1 = this.add.text(W / 2, H * 0.16 + 72, 'catch the robber · dive to close the gap', {
      fontFamily: FONT, fontSize: '30px', fontStyle: '600', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.95).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    const sub2 = this.add.text(W / 2, H * 0.16 + 110, 'hold to open your chute · let go to dive · steer to aim', {
      fontFamily: FONT, fontSize: '24px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.8).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    const hint = this.add.text(W / 2, H * 0.72, 'tap to begin', {
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
    this.startY = this.dude.y;
    this.prevDudeY = this.dude.y;
    this.prevGapC = this.dude.x;
    this.dude.body.allowGravity = true; // he drops into the chase
    // The handoff: the camera freezes here. The robber slides out the bottom
    // and our guy falls in from the top; once he reaches his hold line the
    // camera locks onto him and normal play begins (see the handoff block in
    // update). No obstacles until then.
    this.handoff = true;
    this.handoffScroll = this.cameras.main.scrollY;
    this.handoffStart = this.time.now;
    this.nextRowY = Infinity; // set for real when the handoff completes
    this.tweens.add({ targets: this.titleGroup, alpha: 0, duration: 350, onComplete: () => this.titleGroup.setVisible(false) });
  }

  // ---------- girder rows ----------

  // Which motion a row spawns with, by depth. Static first; wobble eases in;
  // full scroll comes later. Static never disappears, so the beat always has
  // anchors — it never flips to all-moving at once.
  motionFor(depth) {
    if (depth < CFG.depthWobble) return 'static';
    const r = Math.random();
    if (depth < CFG.depthScroll) {
      const pW = Phaser.Math.Linear(0.15, 0.5, (depth - CFG.depthWobble) / (CFG.depthScroll - CFG.depthWobble));
      return r < pW ? 'wobble' : 'static';
    }
    const k = Math.min((depth - CFG.depthScroll) / 20000, 1);
    const pScroll = Phaser.Math.Linear(0.1, 0.4, k);
    if (r < pScroll) return 'scroll';
    if (r < pScroll + 0.42) return 'wobble';
    return 'static';
  }

  // Spacing is a whole number of beats: mostly one, sometimes a two- or
  // three-beat breather (a "gap") to vary the rhythm and give a rest.
  pickInterval() {
    const r = Math.random();
    if (r < 0.74) return 1;
    if (r < 0.92) return 2;
    return 3;
  }

  spawnRow(y) {
    const depth = Math.max(0, y - this.startY);
    const type = this.motionFor(depth);
    let gapW = Phaser.Math.Linear(CFG.rowGapStart, CFG.rowGapMin, Math.min(depth / 40000, 1));
    if (type !== 'static') gapW += CFG.moverGapBonus;
    const margin = 80 + gapW / 2;
    // limit how far the gap jumps from the previous row so the beat reads;
    // movers jump less since they'll also be sliding
    const wander = type === 'static' ? 240 : 150;
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

    // The gap centre bounces between boundL..boundR: a wobble stays near its
    // spawn centre; a scroll traverses (almost) the whole width.
    let speed = 0, boundL = gapC, boundR = gapC;
    if (type === 'wobble') {
      boundL = Math.max(margin, gapC - CFG.wobbleRange);
      boundR = Math.min(W - margin, gapC + CFG.wobbleRange);
      speed = Phaser.Math.Between(CFG.wobbleSpeed[0], CFG.wobbleSpeed[1]) * (Math.random() < 0.5 ? 1 : -1);
    } else if (type === 'scroll') {
      boundL = margin; boundR = W - margin;
      speed = Phaser.Math.Between(CFG.scrollSpeed[0], CFG.scrollSpeed[1]) * (Math.random() < 0.5 ? 1 : -1);
    }
    if (speed) { l.body.setVelocityX(speed); r.body.setVelocityX(speed); }

    this.rows.push({ l, r, y, gapW, type, speed, boundL, boundR, passed: false });
  }

  updateRows(dt) {
    const cam = this.cameras.main;
    while (this.nextRowY < cam.scrollY + H * 2) {
      this.spawnRow(this.nextRowY);
      this.nextRowY += CFG.rowUnit * this.pickInterval();
    }

    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];

      if (row.speed) {
        const centre = row.r.x - row.gapW / 2; // r.x is the gap's right edge
        if (centre <= row.boundL && row.speed < 0) {
          row.speed = -row.speed;
          row.l.body.setVelocityX(row.speed); row.r.body.setVelocityX(row.speed);
        } else if (centre >= row.boundR && row.speed > 0) {
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

  // ---------- the robber & the cash ----------

  updateRobber(time, dt) {
    const r = this.robber;
    const gap = r.y - this.dude.y;

    // steady fall; eased to the dude's pace if he's got too far ahead, so the
    // chase never becomes hopeless when you've been forced to chute a lot
    let vy = CFG.robberVy + this.chaseLevel * CFG.robberEscalate;
    if (this.state === 'playing' && gap > CFG.maxGap) vy = Math.min(vy, this.dude.body.velocity.y);
    r.body.setVelocityY(vy);

    // weave: on the title he idly drifts; in play he threads the gap below him
    let targetX = W / 2;
    if (this.state === 'playing') {
      let below = null;
      for (const row of this.rows) if (row.y > r.y + 30 && (!below || row.y < below.y)) below = row;
      if (below) targetX = below.r.x - below.gapW / 2;
    } else {
      targetX = W / 2 + Math.sin(time / 700) * 130;
    }
    r.x += (targetX - r.x) * Math.min(1, 4 * dt);
    r.x = Phaser.Math.Clamp(r.x, 46, W - 46);
    r.setRotation(Phaser.Math.Clamp((targetX - r.x) * 0.004, -0.22, 0.22));

    if (time > this.nextCashAt) {
      this.dropCash(r.x, r.y - 34);
      this.nextCashAt = time + Phaser.Math.Between(CFG.cashDropMs[0], CFG.cashDropMs[1]);
    }

    // overtook him without touching? he gets away off the top — a fresh one
    // is already falling below (you chase the next of many)
    if (this.state === 'playing' && !this.handoff && r.y < this.cameras.main.scrollY - 120) {
      this.newRobber();
    }
  }

  // send the robber to a fresh lead below and reset him as the next target
  newRobber() {
    this.robber.y = this.dude.y + CFG.escapeGap;
    this.robber.x = Phaser.Math.Between(120, W - 120);
    this.robber.setVelocityY(CFG.robberVy + this.chaseLevel * CFG.robberEscalate);
  }

  dropCash(x, y) {
    const bag = Math.random() < CFG.cashBagChance;
    const c = this.cashGroup.create(x + Phaser.Math.Between(-26, 26), y,
      bag ? 'cash-bag' : 'cash-note').setScale(0.5).setDepth(7);
    c.value = bag ? CFG.cashBag : CFG.cashNote;
    c.body.allowGravity = false;
    c.sway = Phaser.Math.FloatBetween(0, Math.PI * 2);
    c.baseRot = Phaser.Math.FloatBetween(-0.2, 0.2);
  }

  updateCash(time) {
    const cam = this.cameras.main;
    this.cashGroup.getChildren().slice().forEach((c) => {
      c.setRotation(c.baseRot + Math.sin(time / 320 + c.sway) * 0.25); // flutter
      if (c.y < cam.scrollY - 120) this.cashGroup.remove(c, true, true);
    });
  }

  catchRobber() {
    this.caught = true;
    const payday = CFG.catchPayday + this.chaseLevel * 500;
    this.cash += payday;
    this.chaseLevel++;
    this.floatText('GOTCHA!  +$' + payday.toLocaleString('en-US'), this.dude.x, this.dude.y - 30, '#ffd166', 34);
    SFX.payday();
    if (!this.reducedMotion) this.cameras.main.shake(200, 0.007);
    this.cashExplode(this.robber.x, this.robber.y);
    this.newRobber(); // the next one is already falling below
    this.time.delayedCall(450, () => { this.caught = false; });
  }

  cashExplode(x, y) {
    if (this.reducedMotion) return;
    const p = this.add.particles(x, y, 'cash-note', {
      speed: { min: 120, max: 440 }, angle: { min: 190, max: 350 },
      gravityY: 900, lifespan: { min: 800, max: 1500 },
      scale: { start: 0.5, end: 0.32 }, rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(12);
    p.explode(20);
    this.time.delayedCall(1600, () => p.destroy());
  }

  floatText(text, x, y, color, size) {
    const t = this.add.text(x, y - 40, text, {
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: '800', color,
    }).setOrigin(0.5).setDepth(60).setShadow(0, 2, 'rgba(0,0,0,0.35)', 4);
    this.tweens.add({
      targets: t, y: t.y - 74, alpha: 0, duration: 850, ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  updateChevron() {
    const g = this.chevron;
    g.clear();
    if (this.state === 'dead') return;
    const screenY = this.robber.y - this.cameras.main.scrollY;
    if (screenY < H - 24) return; // he's on-screen (or above) — no need to point
    const x = Phaser.Math.Clamp(this.robber.x, 44, W - 44);
    const y = H - 66;
    const pulse = 0.55 + 0.45 * Math.sin(this.time.now / 240);
    g.fillStyle(0x26292f, 0.85);
    g.fillTriangle(x - 26, y, x + 26, y, x, y + 30);
    g.lineStyle(4, 0xf4d03f, pulse);
    g.strokeTriangle(x - 26, y, x + 26, y, x, y + 30);
  }

  // ---------- birds ----------

  spawnBird() {
    const big = Math.random() < CFG.birdBigChance;
    const fromLeft = Math.random() < 0.5;
    const dir = fromLeft ? 1 : -1;
    const y = this.dude.y + Phaser.Math.Between(240, 680); // ahead in the fall
    const x = fromLeft ? -70 : W + 70;
    const b = this.birdsGroup.create(x, y, big ? 'bird-big-up' : 'bird-small-up')
      .setScale(0.5).setDepth(6);
    b.big = big;
    b.setFlipX(dir > 0); // art faces left; flip it to fly right
    const rng = big ? CFG.birdSpeedBig : CFG.birdSpeedSmall;
    b.body.setVelocityX(Phaser.Math.Between(rng[0], rng[1]) * dir);
    // forgiving central hitbox (texture space; scales with the sprite)
    if (big) b.body.setSize(150, 66).setOffset(56, 74);
    else b.body.setSize(94, 52).setOffset(36, 40);
    b.play(big ? 'flap-big' : 'flap-small');
    b.tint0 = 0xffffff;
  }

  updateBirds(time) {
    const depth = this.dude.y - this.startY;
    if (depth > CFG.depthBirds && time > this.nextBirdAt) {
      this.spawnBird();
      this.nextBirdAt = time + Phaser.Math.Between(CFG.birdGapMs[0], CFG.birdGapMs[1]);
    }
    const cam = this.cameras.main;
    this.birdsGroup.getChildren().slice().forEach((b) => {
      if (b.x < -110 || b.x > W + 110 || b.y < cam.scrollY - 140) {
        this.birdsGroup.remove(b, true, true);
      }
    });
  }

  hitBird(bird) {
    if (this.state !== 'playing' || bird.hit) return;
    bird.hit = true;
    if (bird.big) {
      // a wall with wings: knocked out of the sky, tumble (never a splat)
      this.featherBurst(bird.x, bird.y, true);
      SFX.squawk(false);
      this.die(false);
    } else {
      // clattered by a small one: a bounded shove its way + a moment of fluster
      const dir = Math.sign(bird.body.velocity.x) || 1;
      this.dude.body.setVelocityX(dir * CFG.birdNudge);
      this.flusterUntil = this.time.now + CFG.birdFluster;
      this.featherBurst(bird.x, bird.y, false);
      SFX.squawk(true);
      if (!this.reducedMotion) this.cameras.main.shake(90, 0.004);
      this.birdsGroup.remove(bird, true, true);
    }
  }

  featherBurst(x, y, big) {
    if (this.reducedMotion) return;
    const tint = big ? 0x8aa8ba : 0xd68a5a;
    const f = this.add.particles(x, y, 'feather', {
      speed: { min: 40, max: big ? 220 : 170 }, angle: { min: 0, max: 360 },
      gravityY: 260, lifespan: { min: 700, max: 1300 },
      scale: { start: big ? 0.9 : 0.7, end: 0.5 },
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 }, tint, emitting: false,
    }).setDepth(11);
    f.explode(big ? 16 : 10);
    this.time.delayedCall(1400, () => f.destroy());
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
    for (const b of this.birdsGroup.getChildren()) b.setTint(dim);
  }

  // ---------- chute ----------

  // Hitbox follows the pose: tall+narrow hanging under the chute, wide+short
  // for the flat skydiver. Covers head+torso, forgiving at the splayed limbs.
  poseBody(open) {
    if (open) this.dude.body.setSize(56, 150).setOffset(68, 50);
    else this.dude.body.setSize(64, 100).setOffset(64, 66); // compact belly-down mass
  }

  deploy() {
    this.chuteOpen = true;
    this.dude.setTexture('dude-hang');
    this.poseBody(true);
    this.dude.setMaxVelocity(CFG.maxVxOpen, CFG.terminalVy);
    // drive vy by hand while open so the lift is predictable; gravity off
    this.dude.body.allowGravity = false;
    this.dude.setVelocityY(Math.max(this.dude.body.velocity.y - CFG.snapImpulse, CFG.snapLiftCap));
    this.liftUntil = this.time.now + CFG.liftDuration;

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
    SFX.floof();
  }

  closeChute(ranDry) {
    this.chuteOpen = false;
    this.dude.setTexture('dude-fall');
    this.poseBody(false);
    this.dude.body.allowGravity = true; // hand vertical control back to gravity
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

  die(splat) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.canRestart = false;

    const metres = Math.max(0, Math.floor((this.dude.y - this.startY) * CFG.metresPerPx));
    const money = Math.floor(this.cash);
    const isBest = money > this.bestCash;
    if (isBest) {
      this.bestCash = money;
      localStorage.setItem('splat.bestcash', String(money));
    }
    if (metres > this.best) { this.best = metres; localStorage.setItem('splat.best', String(metres)); }

    SFX.wind(0);
    if (this.chuteOpen) this.closeChute(false);
    this.cameras.main.stopFollow();

    if (splat) {
      // direct hit: pancake onto the surface and stick
      SFX.squelch();
      if (!this.reducedMotion) this.cameras.main.shake(320, 0.02);
      this.puffs.explode(24, this.dude.x, this.dude.y);
      this.hair.setVisible(false);
      this.dude.setTexture('dude-fall');
      this.dude.setAngularVelocity(0).setRotation(0);
      this.dude.setVelocity(0, 0).setAcceleration(0, 0);
      this.dude.body.allowGravity = false;
      if (this.reducedMotion) this.dude.setScale(0.74, 0.09);
      else this.tweens.add({ targets: this.dude, scaleX: 0.74, scaleY: 0.09, duration: 140, ease: 'Back.in' });
      this.splatBurst(this.dude.x, this.dude.y);
    } else {
      // glancing hit: tumble off the edge and keep falling
      SFX.crash();
      if (!this.reducedMotion) this.cameras.main.shake(200, 0.008);
      this.puffs.explode(14, this.dude.x, this.dude.y);
      this.dude.setAngularVelocity(Phaser.Math.Between(0, 1) ? 300 : -300);
      this.dude.setVelocityY(Math.min(this.dude.body.velocity.y, 200));
    }

    this.time.delayedCall(splat ? 850 : 650, () => {
      this.canRestart = true;
      this.showGameOver(metres, money, isBest);
    });
  }

  // Cartoon splat: a spread of comic blobs + a fat droplet spray that lingers
  // as a stain. Deliberately non-realistic (bright, rounded, sheen). The whole
  // look lives here — recolour or dial the counts to taste.
  splatBurst(x, y) {
    const n = this.reducedMotion ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const ox = Phaser.Math.Between(-95, 95);
      const oy = Phaser.Math.Between(-18, 32);
      const s = Phaser.Math.FloatBetween(0.28, 0.9);
      const blob = this.add.image(x + ox, y + oy, 'splat-blob').setDepth(9)
        .setAngle(Phaser.Math.Between(0, 359)).setAlpha(0.97);
      if (this.reducedMotion) {
        blob.setScale(s);
      } else {
        blob.setScale(s * 0.1);
        this.tweens.add({ targets: blob, scaleX: s, scaleY: s, duration: Phaser.Math.Between(130, 260), ease: 'Back.out' });
      }
      // sits as a stain, then fades slowly
      this.tweens.add({ targets: blob, alpha: 0, delay: 1800, duration: 900, onComplete: () => blob.destroy() });
    }

    if (this.reducedMotion) return;
    const drops = this.add.particles(x, y - 4, 'drop', {
      speed: { min: 140, max: 520 }, angle: { min: 185, max: 355 },
      gravityY: 1500, lifespan: { min: 650, max: 1200 },
      scale: { start: 1.7, end: 0.35 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, emitting: false,
    }).setDepth(11);
    drops.explode(46);
    this.time.delayedCall(1400, () => drops.destroy());
  }

  showGameOver(metres, money, isBest) {
    const g = this.add.container(0, 0).setScrollFactor(0).setDepth(120).setAlpha(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a2238, 0.82);
    panel.fillRoundedRect(W / 2 - 260, H * 0.30, 520, 320, 28);
    const t1 = this.add.text(W / 2, H * 0.30 + 66, 'splat.', {
      fontFamily: FONT, fontSize: '60px', fontStyle: '800', color: '#ffffff',
    }).setOrigin(0.5);
    const t2 = this.add.text(W / 2, H * 0.30 + 138, `$${money.toLocaleString('en-US')} recovered`, {
      fontFamily: FONT, fontSize: '36px', fontStyle: '700', color: '#ffe08a',
    }).setOrigin(0.5);
    const t3 = this.add.text(W / 2, H * 0.30 + 184, `${metres} m fallen`, {
      fontFamily: FONT, fontSize: '22px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.7);
    const t4 = this.add.text(W / 2, H * 0.30 + 224,
      isBest ? 'new best!' : `best $${this.bestCash.toLocaleString('en-US')}`, {
        fontFamily: FONT, fontSize: '24px', fontStyle: '600',
        color: isBest ? '#ffd166' : '#ffffff',
      }).setOrigin(0.5).setAlpha(isBest ? 1 : 0.7);
    const t5 = this.add.text(W / 2, H * 0.30 + 272, 'tap to go again', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.9);
    g.add([panel, t1, t2, t3, t4, t5]);
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
      // title: the camera holds the robber as he falls and sheds cash; our guy
      // is pinned a screen above him, off-frame, waiting to give chase
      this.updateRobber(time, dt);
      this.updateCash(time);
      this.dude.y = this.robber.y - CFG.titleGap;
      this.dude.x = W / 2;
      this.cameras.main.scrollY = this.robber.y - H * CFG.titleFrac;
      this.updateClouds();
      this.updateSky(0); // pinned to the first sky band
      this.updateChevron();
      this.cashText.setText('$0');
      this.depthText.setText('0 m');
      this.drawJuice();
      return;
    }

    const body = this.dude.body;
    const vy = body.velocity.y;
    const speed01 = Phaser.Math.Clamp(vy / CFG.terminalVy, 0, 1);

    if (this.state === 'playing' && this.handoff) {
      // camera frozen while the robber slides out the bottom and our guy falls
      // in from the top; lock on once he reaches his hold line
      this.cameras.main.scrollY = this.handoffScroll;
      const reached = (this.dude.y - this.handoffScroll) >= H * CFG.holdFrac;
      if (reached || time - this.handoffStart > 3500) {
        this.handoff = false;
        this.nextRowY = this.dude.y + H * 0.9; // a clear screen before the first girder
        this.prevDudeY = this.dude.y;
      }
    }

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
      if (time < this.flusterUntil) ax *= 0.25; // dazed after a bird clatters you
      body.setAccelerationX(ax);
      // gentle air drag when not steering; suspended briefly so a bird shove carries
      if (!ax && time >= this.flusterUntil) body.setVelocityX(body.velocity.x * Math.exp(-3 * dt));

      // keep him on screen
      if (this.dude.x < 40) { this.dude.x = 40; if (body.velocity.x < 0) body.setVelocityX(0); }
      if (this.dude.x > W - 40) { this.dude.x = W - 40; if (body.velocity.x > 0) body.setVelocityX(0); }

      // --- chute (locked out during the handoff, so he freefalls into frame) ---
      const holding = !this.handoff && (this.keys.SPACE.isDown || this.keys.W.isDown
        || this.cursors.up.isDown || this.input.activePointer.isDown);
      if (!holding) this.mustRelease = false; // ran dry: require a fresh press
      const wantOpen = holding && !this.mustRelease && this.juice > 2;
      if (wantOpen && !this.chuteOpen) this.deploy();
      else if (!holding && this.chuteOpen) this.closeChute(false);

      if (this.chuteOpen) {
        this.juice = Math.max(0, this.juice - CFG.juiceDrain * dt);
        if (this.juice <= 0) { this.mustRelease = true; this.closeChute(true); }
        else {
          // lift upward for a beat, then settle into the gentle float.
          // Read velocity fresh: deploy() may have set the snap kick this
          // very frame, and the top-of-update `vy` is stale by then.
          const cur = body.velocity.y;
          const target = time < this.liftUntil ? CFG.liftVel : CFG.chuteVy;
          body.setVelocityY(cur + (target - cur) * (1 - Math.exp(-CFG.chuteEase * dt)));
        }
      } else {
        this.juice = Math.min(CFG.juiceMax, this.juice + CFG.juiceRefill * dt);
      }

      // gentle body tilt with horizontal speed
      this.dude.rotation = (body.velocity.x / CFG.maxVxOpen) * 0.14;

      if (!this.handoff) { this.updateRows(dt); this.updateBirds(time); }
      this.updateRobber(time, dt);
      this.updateCash(time);
      // you're on the case: a slow trickle of cash for every metre you fall
      this.cash += Math.max(0, this.dude.y - this.prevDudeY) * CFG.depthTrickle;
      this.prevDudeY = this.dude.y;
      this.cashText.setText('$' + Math.floor(this.cash).toLocaleString('en-US'));
      this.depthText.setText(`${Math.max(0, Math.floor((this.dude.y - this.startY) * CFG.metresPerPx))} m`);
      SFX.wind(this.chuteOpen ? speed01 * 0.4 : speed01);
    }

    // once the handoff is done, hold the dude at a fixed screen height
    if (this.state === 'playing' && !this.handoff) {
      this.cameras.main.scrollY = this.dude.y - H * CFG.holdFrac;
    }

    this.positionHair(time, 0.28 + 0.8 * speed01, dt);
    this.drawChute(time);
    this.updateChevron();
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
