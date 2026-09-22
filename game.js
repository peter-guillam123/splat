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
  pullCost: 22,          // spent up front on every ripcord pull: mashing empties it
  rearmMs: 620,          // after you let go, the cord needs this long to re-arm
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
  titleGap: 1700,        // how far below he starts, and the handoff lead-in
  catchDist: 62,         // gap (px) at which you reach him
  escapeGap: 1680,       // fresh lead he bolts to after a catch
  maxGap: 3400,          // he eases off past this so the chase stays winnable
  cashDropMs: [480, 1050], // how often he sheds a note
  cashBagChance: 0.12,   // rest are notes
  cashNote: 60,          // $ per note
  cashBag: 350,          // $ per bag
  catchPayday: 1000,     // $ for catching him (grows with the chase level)
  holdFrac: 0.36,        // where the dude is held on screen (fraction from top)
  titleFrac: 0.5,        // where the robber sits on the title
  // --- grenades on the trail ---
  depthGrenades: 7000,   // he starts lobbing grenades here (~70 m)
  grenadeChance: 0.24,   // chance a drop is a grenade rather than cash
  grenadeFuseMs: [2200, 3300], // fuse before it blows on its own
  grenadeFall: 55,       // gentle drift down as it sits on the trail
  blastRadius: 155,      // how near the blast has to be to tumble you
};

// Sky bands the fall cycles through: day → sunset → night → dawn → day…
const SKY_BANDS = [
  { sky: [0x6d, 0xb3, 0xe8], horizon: [0xd8, 0xee, 0xfb], night: 0 },   // day
  { sky: [0x9a, 0x6f, 0xa8], horizon: [0xf7, 0xb8, 0x78], night: 0 },   // sunset
  { sky: [0x1c, 0x21, 0x40], horizon: [0x4a, 0x5a, 0x8a], night: 1 },   // night
  { sky: [0x5a, 0x7a, 0xb0], horizon: [0xf2, 0xd5, 0xa8], night: 0.2 }, // dawn
];
const BAND_PX = 7000;

// Zones: seamless bands the fall passes through, by depth (px below the start).
// Each has a background, an obstacle skin, a flying-hazard skin, side walls, and
// whether the open sky (with its day/night cycle) is visible. One blends into
// the next over ZONE_FADE px just before its boundary. bg = [background, glow].
const ZONES = [
  { key: 'sky',  start: 0,     sky: true,  clouds: true,  obstacle: 'girder',   bird: 'gull',   wall: null,       bg: null },
  { key: 'city', start: 10000, sky: true,  clouds: false, obstacle: 'ledge',    bird: 'pigeon', wall: 'facade',   bg: null },
  { key: 'hole', start: 26000, sky: false, clouds: false, obstacle: 'rock',     bird: 'bat',    wall: 'rockwall', bg: [0x2a2320, 0x4a3a30] },
  { key: 'lava', start: 46000, sky: false, clouds: false, obstacle: 'lavarock', bird: 'bat',    wall: 'lavawall', bg: [0x1c100c, 0xff5a1a] },
];
const ZONE_FADE = 1400;

const FONT = '"Space Grotesk", -apple-system, system-ui, sans-serif';

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
    this.load.svg('grenade', 'assets/grenade.svg', { width: 128, height: 160 });
    // zone skins
    this.load.svg('ledge', 'assets/ledge.svg', { width: 256, height: 80 });
    this.load.svg('rock', 'assets/rock.svg', { width: 256, height: 80 });
    this.load.svg('lavarock', 'assets/lavarock.svg', { width: 256, height: 80 });
    this.load.svg('facade', 'assets/facade.svg', { width: 320, height: 512 });
    this.load.svg('rockwall', 'assets/rockwall.svg', { width: 320, height: 512 });
    this.load.svg('lavawall', 'assets/lavawall.svg', { width: 320, height: 512 });
    this.load.svg('bat-up', 'assets/bat-up.svg', { width: 160, height: 100 });
    this.load.svg('bat-down', 'assets/bat-down.svg', { width: 160, height: 100 });
    this.load.svg('sniper', 'assets/sniper.svg', { width: 192, height: 192 });
    this.load.svg('road', 'assets/road.svg', { width: 256, height: 192 });
  }

  create() {
    this.reducedMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.state = 'ready';
    this.startY = 300;
    this.chuteOpen = false;
    this.juice = CFG.juiceMax;
    this.rearmUntil = 0; // ripcord re-arm timer
    this.rows = [];
    this.clouds = [];
    this.nextRowY = this.startY + H * 1.35;
    this.prevGapC = W / 2;
    this.best = parseInt(localStorage.getItem('splat.best') || '0', 10);
    this.bestCash = parseInt(localStorage.getItem('splat.bestcash') || '0', 10);
    this.cash = 0;         // headline score, in dollars
    this.chaseLevel = 0;   // rises each catch; the robber gets faster
    this.nextCashAt = 0;

    this.cameras.main.setBounds(0, -2000, W, 4e9);

    this.buildGeneratedTextures();
    this.buildSky();
    this.buildDude();
    this.buildUI();
    this.buildInput();

    this.girders = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.collider(this.dude, this.girders, (dude, girder) => {
      // landing on a surface (top/bottom) is a splat; clipping the end of a bar
      // is a side hit that starts a tumble. A tumble that then lands on a
      // surface splats — that's when it's really over.
      const t = dude.body.touching;
      const topHit = t.down || t.up;
      if (this.state === 'playing') {
        if (topHit) this.splatDeath(girder, t); else this.startTumble();
      } else if (this.state === 'tumbling' && topHit) {
        this.splatDeath(girder, t);
      }
    });

    // ---- birds ----
    this.anims.create({ key: 'flap-big', frameRate: 5, repeat: -1,
      frames: [{ key: 'bird-big-up' }, { key: 'bird-big-down' }] });
    this.anims.create({ key: 'flap-small', frameRate: 13, repeat: -1,
      frames: [{ key: 'bird-small-up' }, { key: 'bird-small-down' }] });
    this.anims.create({ key: 'flap-bat', frameRate: 10, repeat: -1,
      frames: [{ key: 'bat-up' }, { key: 'bat-down' }] });
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
    // grab the cash he sheds for money; but to claim HIM you must touch him,
    // not merely fall past his depth
    this.cashGroup = this.physics.add.group({ allowGravity: false });
    this.physics.add.overlap(this.dude, this.cashGroup, (dude, c) => this.grabCash(c));

    // grenades he lobs behind him — touch one and it goes off
    this.grenadeGroup = this.physics.add.group({ allowGravity: false });
    this.physics.add.overlap(this.dude, this.grenadeGroup, (dude, g) => this.detonate(g));

    this.robber = this.physics.add.sprite(W / 2, this.startY + CFG.titleGap, 'robber-fall')
      .setScale(0.5).setDepth(10);
    this.robber.body.allowGravity = false;
    this.robber.body.setVelocityY(CFG.robberVy);
    this.robber.body.setSize(140, 120).setOffset(26, 68); // generous "touch" area
    this.caught = false; // brief guard after a catch
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
    if (!this.textures.exists('flash')) {
      // soft radial flash for the grenade blast
      const c = this.textures.createCanvas('flash', 64, 64);
      const ctx = c.getContext();
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,224,150,0.95)');
      grad.addColorStop(0.7, 'rgba(255,138,44,0.6)');
      grad.addColorStop(1, 'rgba(255,138,44,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      c.refresh();
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

    // Zone backdrops: near wall strips at the screen edges and a wider, darker
    // far set tucked behind them, each scrolling at its own parallax so the
    // canyon/shaft has depth. Faded in and out by zone weight in updateSky.
    this.walls = [];
    for (const z of ZONES) {
      if (!z.wall) continue;
      const layers = [];
      const mk = (x, w, par, tint, baseAlpha, depth, flip) => {
        const L = this.add.tileSprite(x, 0, w, H, z.wall).setOrigin(0, 0)
          .setScrollFactor(0).setDepth(depth).setAlpha(0).setVisible(false).setTint(tint);
        L.setTileScale(0.5);
        if (flip) L.setFlipX(true);
        L.par = par; L.baseAlpha = baseAlpha;
        layers.push(L);
      };
      mk(24, 230, 0.38, 0x7d838f, 0.92, 0.8, false);
      mk(W - 24 - 230, 230, 0.38, 0x7d838f, 0.92, 0.8, true);
      mk(0, 140, 0.72, 0xffffff, 1, 0.9, false);
      mk(W - 140, 140, 0.72, 0xffffff, 1, 0.9, true);
      this.walls.push({ zone: z, layers });
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

    // live HUD is just the money — everything else waits for game over
    this.cashText = ui(this.add.text(W - 26, 22, '$0', {
      fontFamily: FONT, fontSize: '52px', fontStyle: '700', color: '#ffd34d',
    }).setOrigin(1, 0).setLetterSpacing(1).setShadow(0, 2, 'rgba(0,0,0,0.35)', 6));

    // custom mute glyph (no more emoji)
    this.muteIcon = ui(this.add.graphics()).setPosition(38, 40);
    this.drawMute();
    this.muteHit = ui(this.add.zone(38, 40, 56, 56).setInteractive({ useHandCursor: true }));
    this.muteHit.on('pointerdown', (p, x, y, event) => {
      SFX.ensure();
      SFX.setMuted(!SFX.muted);
      this.drawMute();
      event.stopPropagation();
    });

    // ---- title overlay ----
    this.titleGroup = this.add.container(0, 0).setScrollFactor(0).setDepth(110);
    const title = this.add.text(W / 2, H * 0.18, 'SPLAT!', {
      fontFamily: FONT, fontSize: '132px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5).setShadow(0, 4, 'rgba(0,0,0,0.28)', 14).setLetterSpacing(2);
    const sub = this.add.text(W / 2, H * 0.18 + 92, 'catch the robber · hold to open your chute', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.9).setLetterSpacing(0.5).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    const hint = this.add.text(W / 2, H * 0.72, 'tap to begin', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setLetterSpacing(3).setShadow(0, 2, 'rgba(0,0,0,0.25)', 5);
    this.titleGroup.add([title, sub, hint]);
    if (!this.reducedMotion) {
      this.tweens.add({ targets: hint, alpha: 0.35, duration: 750, yoyo: true, repeat: -1 });
      this.tweens.add({ targets: title, y: '+=9', duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    this.overGroup = null; // built on death
  }

  // A clean speaker glyph drawn by hand: waves when on, a small × when muted.
  drawMute() {
    const g = this.muteIcon;
    g.clear();
    const col = 0xffffff, a = 0.8;
    g.fillStyle(col, a);
    g.fillPoints([
      { x: -11, y: -4 }, { x: -5, y: -4 }, { x: 1, y: -10 },
      { x: 1, y: 10 }, { x: -5, y: 4 }, { x: -11, y: 4 },
    ], true);
    g.lineStyle(2.6, col, a);
    if (!SFX.muted) {
      g.beginPath(); g.arc(0, 0, 6.5, -0.85, 0.85); g.strokePath();
      g.beginPath(); g.arc(0, 0, 11.5, -0.8, 0.8); g.strokePath();
    } else {
      g.lineBetween(6, -5, 14, 5);
      g.lineBetween(14, -5, 6, 5);
    }
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
    const skin = this.zoneAt(depth).obstacle; // girder / ledge / rock / lavarock
    const l = this.add.tileSprite(gapL - W, y, W, 40, skin).setOrigin(0, 0.5).setDepth(5);
    const r = this.add.tileSprite(gapR, y, W, 40, skin).setOrigin(0, 0.5).setDepth(5);
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
    SFX.phew();
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

  updateClouds(depth) {
    const cam = this.cameras.main;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      const screenY = c.y - cam.scrollY * c.sf;
      if (screenY < -160) { c.destroy(); this.clouds.splice(i, 1); }
    }
    if (this.zoneAt(depth).clouds) while (this.clouds.length < 6) this.spawnCloud(false);
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
      const depth = this.dude.y - this.startY;
      if (this.state === 'playing' && depth > CFG.depthGrenades && Math.random() < CFG.grenadeChance) {
        this.dropGrenade(r.x, r.y - 30, time);
      } else {
        this.dropCash(r.x, r.y - 34);
      }
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

  grabCash(c) {
    if (this.state !== 'playing' || c.grabbed) return;
    c.grabbed = true;
    this.cash += c.value;
    SFX.chaching(c.value >= CFG.cashBag);
    this.floatText('+$' + c.value, c.x, c.y, '#8ef0a0', 24);
    this.cashGroup.remove(c, true, true);
  }

  dropGrenade(x, y, time) {
    const g = this.grenadeGroup.create(Phaser.Math.Clamp(x + Phaser.Math.Between(-24, 24), 40, W - 40), y, 'grenade')
      .setScale(0.5).setDepth(7);
    g.body.allowGravity = false;
    g.body.setVelocityY(CFG.grenadeFall);
    g.body.setSize(120, 130).setOffset(4, 42); // the round body, not the fuse
    g.fuseAt = time + Phaser.Math.Between(CFG.grenadeFuseMs[0], CFG.grenadeFuseMs[1]);
    g.spin = Phaser.Math.FloatBetween(-1.2, 1.2);
  }

  updateGrenades(time) {
    const cam = this.cameras.main;
    this.grenadeGroup.getChildren().slice().forEach((g) => {
      g.rotation += g.spin * 0.02; // slow tumble as it falls
      const left = g.fuseAt - time;
      // flash red as the fuse runs out, faster the closer it gets
      if (left < 900) {
        const hz = left < 350 ? 26 : 14;
        g.setTint(Math.sin(time / 1000 * hz) > 0 ? 0xff5a3c : 0xffffff);
      }
      if (left <= 0) { this.detonate(g); return; }
      if (g.y < cam.scrollY - 140) this.grenadeGroup.remove(g, true, true);
    });
  }

  detonate(g) {
    if (g.gone) return;
    g.gone = true;
    const x = g.x, y = g.y;
    this.grenadeGroup.remove(g, true, true);
    this.explode(x, y);
    // caught in the blast? knocked into a tumble
    if ((this.state === 'playing') &&
        Phaser.Math.Distance.Between(x, y, this.dude.x, this.dude.y) < CFG.blastRadius) {
      this.startTumble();
    }
  }

  explode(x, y) {
    SFX.boom();
    if (!this.reducedMotion) this.cameras.main.shake(220, 0.012);
    if (this.reducedMotion) return;
    const flash = this.add.image(x, y, 'flash').setDepth(12).setScale(0.6).setAlpha(0.95);
    this.tweens.add({ targets: flash, scale: 4.2, alpha: 0, duration: 320, ease: 'Cubic.out', onComplete: () => flash.destroy() });
    const p = this.add.particles(x, y, 'puff', {
      speed: { min: 120, max: 460 }, angle: { min: 0, max: 360 },
      gravityY: 300, lifespan: { min: 500, max: 1000 },
      scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffe6a0, 0xff8a2c, 0xd14a1e, 0x555555], emitting: false,
    }).setDepth(12);
    p.explode(26);
    this.time.delayedCall(1100, () => p.destroy());
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
    const zone = this.zoneAt(this.dude.y - this.startY);
    const bat = zone.bird === 'bat';
    const b = this.birdsGroup.create(x, y, bat ? 'bat-up' : (big ? 'bird-big-up' : 'bird-small-up'))
      .setScale(bat ? (big ? 0.85 : 0.55) : 0.5).setDepth(6);
    b.bat = bat;
    // pigeons are the gulls gone grey; lava bats catch the glow
    b.zoneTint = zone.bird === 'pigeon' ? 0xa9adb8 : (zone.key === 'lava' ? 0xffb08a : null);
    b.big = big;
    b.setFlipX(dir > 0); // art faces left; flip it to fly right
    const rng = big ? CFG.birdSpeedBig : CFG.birdSpeedSmall;
    b.body.setVelocityX(Phaser.Math.Between(rng[0], rng[1]) * dir);
    // forgiving central hitbox (texture space; scales with the sprite)
    if (bat) b.body.setSize(84, 52).setOffset(38, 26);
    else if (big) b.body.setSize(150, 66).setOffset(56, 74);
    else b.body.setSize(94, 52).setOffset(36, 40);
    b.play(bat ? 'flap-bat' : (big ? 'flap-big' : 'flap-small'));
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
      // a wall with wings: knocked into a tumble, which ends when he lands
      this.featherBurst(bird.x, bird.y, true);
      SFX.squawk(false);
      this.startTumble();
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

  // Which zone we're in and how far it has blended into the next.
  zoneBlend(depth) {
    let i = 0;
    for (let k = 0; k < ZONES.length; k++) if (depth >= ZONES[k].start) i = k;
    const next = ZONES[i + 1];
    const t = next ? Phaser.Math.Clamp((depth - (next.start - ZONE_FADE)) / ZONE_FADE, 0, 1) : 0;
    return { i, j: next ? i + 1 : i, t };
  }
  zoneAt(depth) { const b = this.zoneBlend(depth); return ZONES[b.t < 0.5 ? b.i : b.j]; }
  hexRGB(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  mulTint(a, b) {
    const A = this.hexRGB(a), B = this.hexRGB(b);
    return Phaser.Display.Color.GetColor(
      Math.round(A[0] * B[0] / 255), Math.round(A[1] * B[1] / 255), Math.round(A[2] * B[2] / 255));
  }

  updateSky(depth) {
    // the open-sky day/night cycle
    const pos = (depth / BAND_PX) % SKY_BANDS.length;
    const i = Math.floor(pos) % SKY_BANDS.length;
    const j = (i + 1) % SKY_BANDS.length;
    const f = pos - Math.floor(pos);
    const lerp = (a, b) => Math.round(Phaser.Math.Linear(a, b, f));
    const A = SKY_BANDS[i], B = SKY_BANDS[j];
    const skyRGB = [lerp(A.sky[0], B.sky[0]), lerp(A.sky[1], B.sky[1]), lerp(A.sky[2], B.sky[2])];
    const horRGB = [lerp(A.horizon[0], B.horizon[0]), lerp(A.horizon[1], B.horizon[1]), lerp(A.horizon[2], B.horizon[2])];
    const night = Phaser.Math.Linear(A.night, B.night, f);

    // zone blend: background is the cycling sky where the sky shows, or the
    // zone's own colours underground, mixed across the fade
    const zb = this.zoneBlend(depth);
    const zi = ZONES[zb.i], zj = ZONES[zb.j];
    const wI = 1 - zb.t, wJ = zb.t;
    const skyW = (zi.sky ? wI : 0) + (zj.sky ? wJ : 0);
    const colOf = (z, k) => z.bg ? this.hexRGB(z.bg[k]) : (k === 0 ? skyRGB : horRGB);
    const mix = (a, b) => Phaser.Display.Color.GetColor(
      Math.round(a[0] * wI + b[0] * wJ), Math.round(a[1] * wI + b[1] * wJ), Math.round(a[2] * wI + b[2] * wJ));
    this.cameras.main.setBackgroundColor(mix(colOf(zi, 0), colOf(zj, 0)));
    this.glow.setTint(mix(colOf(zi, 1), colOf(zj, 1)));
    this.skyW = skyW;
    this.zoneNow = ZONES[zb.t < 0.5 ? zb.i : zb.j];

    const t = this.time.now;
    for (const s of this.stars) s.setAlpha(night * skyW * (0.5 + 0.5 * Math.sin(t / 900 + s.twinkle)));

    // zone walls: fade by zone weight and scroll with the camera at their parallax
    const sy = this.cameras.main.scrollY;
    for (const wset of this.walls) {
      const w = wset.zone === zi ? wI : (wset.zone === zj ? wJ : 0);
      for (const L of wset.layers) {
        L.setVisible(w > 0.001);
        L.setAlpha(w * L.baseAlpha);
        if (w > 0.001) L.tilePositionY = sy * L.par * 2;
      }
    }

    // dim the scenery as night falls, only where the sky is actually showing
    const nd = night * skyW;
    const dim = Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(255, 158, nd)),
      Math.round(Phaser.Math.Linear(255, 170, nd)),
      Math.round(Phaser.Math.Linear(255, 205, nd)));
    for (const row of this.rows) { row.l.setTint(dim); row.r.setTint(dim); }
    for (const c of this.clouds) c.setTint(dim);
    for (const b of this.birdsGroup.getChildren()) b.setTint(b.zoneTint ? this.mulTint(dim, b.zoneTint) : dim);
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
    this.juice = Math.max(0, this.juice - CFG.pullCost); // the pull itself costs
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
    this.rearmUntil = this.time.now + CFG.rearmMs;
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

  // Lock the score at the moment of the fatal contact (the tumble that follows
  // doesn't earn anything).
  lockScore() {
    const metres = Math.max(0, Math.floor((this.dude.y - this.startY) * CFG.metresPerPx));
    const money = Math.floor(this.cash);
    this.deathIsBest = money > this.bestCash;
    if (this.deathIsBest) { this.bestCash = money; localStorage.setItem('splat.bestcash', String(money)); }
    if (metres > this.best) { this.best = metres; localStorage.setItem('splat.best', String(metres)); }
    this.deathMetres = metres;
    this.deathMoney = money;
  }

  gameOverSoon(delay) {
    this.time.delayedCall(delay, () => {
      this.canRestart = true;
      if (!this.overGroup) this.showGameOver(this.deathMetres, this.deathMoney, this.deathIsBest);
    });
  }

  // A glancing/side hit (or a big bird) knocks him into a spin — but he's not
  // done yet: he keeps falling, tumbling, until he lands on a surface and
  // splats (see splatDeath). If he threads every gap, a safety timer ends it.
  startTumble() {
    if (this.state !== 'playing') return;
    this.state = 'tumbling';
    this.canRestart = false;
    this.lockScore();
    SFX.wind(0);
    SFX.screech();
    SFX.crash();
    if (this.chuteOpen) this.closeChute(false);
    this.dude.setAngularVelocity(Phaser.Math.Between(0, 1) ? 320 : -320);
    this.dude.body.setAcceleration(0, 0);
    this.dude.body.setVelocityY(Math.min(this.dude.body.velocity.y, 260));
    if (!this.reducedMotion) this.cameras.main.shake(160, 0.007);
    this.puffs.explode(12, this.dude.x, this.dude.y);
    this.time.delayedCall(3400, () => {
      if (this.state === 'tumbling') { this.state = 'dead'; this.gameOverSoon(0); }
    });
  }

  // A direct connect with a surface — either straight down while playing, or the
  // moment a tumble lands. He pancakes onto it and that's the end.
  splatDeath(girder, t) {
    if (this.state !== 'playing' && this.state !== 'tumbling') return;
    const wasPlaying = this.state === 'playing';
    this.state = 'dead';
    this.canRestart = false;
    if (wasPlaying) this.lockScore(); // a tumble already locked it

    SFX.wind(0);
    if (wasPlaying) SFX.screech();
    SFX.squelch();
    if (this.chuteOpen) this.closeChute(false);
    this.cameras.main.stopFollow();

    this.dude.y = t.down ? girder.body.top - 6 : girder.body.bottom + 6;
    this.dude.setAngularVelocity(0).setRotation(0);
    this.dude.setVelocity(0, 0).setAcceleration(0, 0);
    this.dude.body.allowGravity = false;
    this.hair.setVisible(false);
    this.dude.setTexture('dude-fall');
    if (this.reducedMotion) this.dude.setScale(0.74, 0.09);
    else this.tweens.add({ targets: this.dude, scaleX: 0.74, scaleY: 0.09, duration: 140, ease: 'Back.in' });
    if (!this.reducedMotion) this.cameras.main.shake(320, 0.02);
    this.puffs.explode(24, this.dude.x, this.dude.y);
    this.splatBurst(this.dude.x, this.dude.y);
    this.gameOverSoon(850);
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
    const cy = H * 0.34;
    const g = this.add.container(0, 0).setScrollFactor(0).setDepth(120).setAlpha(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x121826, 0.86);
    panel.fillRoundedRect(W / 2 - 240, cy, 480, 268, 32);
    // small caption, then the money huge, then one stat line, then the prompt
    const cap = this.add.text(W / 2, cy + 48, 'splat', {
      fontFamily: FONT, fontSize: '26px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.55).setLetterSpacing(4);
    const big = this.add.text(W / 2, cy + 116, `$${money.toLocaleString('en-US')}`, {
      fontFamily: FONT, fontSize: '76px', fontStyle: '700', color: '#ffd34d',
    }).setOrigin(0.5).setLetterSpacing(1);
    const stat = this.add.text(W / 2, cy + 176,
      `${metres} m  ·  ${isBest ? 'new best' : 'best $' + this.bestCash.toLocaleString('en-US')}`, {
        fontFamily: FONT, fontSize: '22px', fontStyle: '500',
        color: isBest ? '#ffd34d' : '#ffffff',
      }).setOrigin(0.5).setAlpha(isBest ? 0.95 : 0.6).setLetterSpacing(0.5);
    const prompt = this.add.text(W / 2, cy + 226, 'tap to retry', {
      fontFamily: FONT, fontSize: '22px', fontStyle: '500', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0.85).setLetterSpacing(3);
    g.add([panel, cap, big, stat, prompt]);
    this.tweens.add({ targets: g, alpha: 1, duration: 250 });
    if (!this.reducedMotion) this.tweens.add({ targets: prompt, alpha: 0.35, duration: 750, yoyo: true, repeat: -1 });
    this.overGroup = g;
  }

  drawJuice() {
    const g = this.juiceBar;
    g.clear();
    const bw = 300, bh = 10, bx = W / 2 - bw / 2, by = 34;
    g.fillStyle(0xffffff, 0.16); // subtle track
    g.fillRoundedRect(bx, by, bw, bh, bh / 2);
    const frac = this.juice / CFG.juiceMax;
    const low = frac < 0.25;
    let alpha = 1;
    if (this.juice <= 0.01) alpha = 0.45 + 0.55 * Math.sin(this.time.now / 90); // empty: flash
    const rearming = !this.chuteOpen && this.time.now < this.rearmUntil;
    if (rearming) alpha *= 0.35 + 0.25 * Math.sin(this.time.now / 60); // dim pulse while the cord re-arms
    if (frac > 0.001) {
      g.fillStyle(rearming ? 0xffffff : (low ? 0xff5a3c : 0xffce54), alpha);
      g.fillRoundedRect(bx, by, Math.max(bw * frac, bh), bh, bh / 2);
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
      this.updateClouds(0);
      this.updateSky(0); // pinned to the first sky band
      this.updateChevron();
      this.cashText.setText('$0');
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
      // a pull costs a chunk up front and the cord must have re-armed since the
      // last release — so mashing the chute to hover no longer works
      const wantOpen = holding && !this.mustRelease && this.juice >= CFG.pullCost && time >= this.rearmUntil;
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
      this.updateGrenades(time);
      // money is earned, never given: only cash pickups and catching him pay
      this.cashText.setText('$' + Math.floor(this.cash).toLocaleString('en-US'));
      SFX.wind(this.chuteOpen ? speed01 * 0.4 : speed01);
    }

    // hold the dude at a fixed screen height in play, and keep watching him as
    // he tumbles so we see him land
    if ((this.state === 'playing' || this.state === 'tumbling') && !this.handoff) {
      this.cameras.main.scrollY = this.dude.y - H * CFG.holdFrac;
    }

    this.positionHair(time, 0.28 + 0.8 * speed01, dt);
    this.drawChute(time);
    this.updateChevron();
    const depthNow = Math.max(0, this.dude.y - this.startY);
    this.updateClouds(depthNow);
    this.updateSky(depthNow);
    this.drawJuice();
  }

  positionHair(time, targetStream, dt = 1 / 60) {
    // under-damped spring so the hair overshoots and settles — the whip
    const s = this.hairSpring;
    s.v += (targetStream - s.cur) * 90 * dt;
    s.v *= Math.exp(-10 * dt);
    s.cur += s.v * dt;
    s.cur = Phaser.Math.Clamp(s.cur, 0.15, 1.5);

    // root sits at the middle of the head, so the head (drawn in front) hides
    // its base and the hair reads as streaming from behind the skull
    this.hair.x = this.dude.x - Math.sin(this.dude.rotation) * 14;
    this.hair.y = this.dude.y - 14 * Math.cos(this.dude.rotation);
    this.hair.setScale(0.5, 0.5 * s.cur);
    this.hair.rotation = this.dude.rotation
      - (this.dude.body ? this.dude.body.velocity.x : 0) / CFG.maxVxOpen * 0.3
      + Math.sin(time / 300) * 0.05;
  }
}

function boot() {
  // if a healthy game is already up, leave it; if a broken one exists
  // (object but no canvas), tear it down and rebuild
  if (window.game) {
    if (document.querySelector('#game canvas')) return;
    try { window.game.destroy(true); } catch (e) { /* ignore */ }
    window.game = null;
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
}

// Prefer starting once the font has settled so labels use it from frame one,
// but NEVER let font loading hold the game back — race it against a short
// timeout, and fall back if the Font API is missing.
if (document.fonts && document.fonts.ready) {
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]).then(boot);
} else {
  boot();
}
