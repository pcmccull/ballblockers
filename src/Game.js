import { resolveCircleCollision, constrainPusher } from './Physics.js';
import * as Settings from './settings.js';
import { AIController, AI_DIFFICULTY } from './AiPlayer.js';
import { drawBlock } from './PixelDropText.js';

const POWERUP_COLORS = { speed: '#ffd23f', cross: '#5dff8a' };

// Drops are pixel sprites built from the same beveled blocks as the text and
// goals. Each one drops in block by block from the top of the screen.
const POWERUP_SPRITES = {
  speed: [
    '...####',
    '..####.',
    '..###..',
    '.###...',
    '.######',
    '######.',
    '...###.',
    '..###..',
    '..##...',
    '.##....',
    '.#.....',
  ],
  cross: [
    '...#...#...',
    '..##...##..',
    '.#########.',
    '###########',
    '.#########.',
    '..##...##..',
    '...#...#...',
  ],
};
const POWERUP_SPRITE_SPAN = 11;   // blocks across the sprite's long side
const POWERUP_FALL_TIME = 0.4;    // seconds for a block to fall from the top of the screen
const POWERUP_ROW_STAGGER = 0.04; // seconds between rows starting to fall, bottom row first
const POWERUP_LAND_FLASH = 0.25;  // seconds a block glows white after landing
const POWERUP_RING_TIME = 0.6;    // seconds for a beacon ring to expand and fade
const POWERUP_RING_EVERY = 1.2;   // seconds between beacon rings once landed

// Seconds from a drop spawning until its last block has landed
function powerUpDropTime(type) {
  return (POWERUP_SPRITES[type].length - 1) * POWERUP_ROW_STAGGER + POWERUP_FALL_TIME;
}

// Round pieces (pucks, pushers) are drawn as discs of beveled pixel blocks to
// match the goals and text, with shading lit from the top-left so they read
// as slightly domed. Each look is rendered once to an offscreen canvas.
const discCache = new Map();

// `fill` is the disc's colour, `rim` the colour of its outermost ring of
// blocks, and `dimRows` how many block rows from the top are drawn faded
// (the drained part of a pusher's stamina).
function getPixelDisc(radius, cell, fill, rim, dimRows) {
  const key = `${radius}|${cell}|${fill}|${rim}|${dimRows}`;
  let img = discCache.get(key);
  if (img) return img;
  if (discCache.size > 200) discCache.clear();

  const n = Math.ceil(radius / cell);
  const inside = (i, j) => Math.hypot((i + 0.5) * cell, (j + 0.5) * cell) <= radius;
  img = document.createElement('canvas');
  img.width = img.height = 2 * n * cell;
  const ctx = img.getContext('2d');
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      if (!inside(i, j)) continue;
      const x = (i + n) * cell;
      const y = (j + n) * cell;
      const edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
      ctx.globalAlpha = !edge && j + n < dimRows ? 0.25 : 1;
      // Back each block with a darker shade so the gaps between blocks read
      // as grout lines rather than see-through holes
      ctx.fillStyle = edge ? rim : fill;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(x, y, cell, cell);
      drawBlock(ctx, x, y, cell, edge ? rim : fill, 0);

      // Dome shading: brighter toward the top-left, darker toward the
      // bottom-right, plus a small specular hotspot
      const nx = (i + 0.5) * cell / radius;
      const ny = (j + 0.5) * cell / radius;
      const light = -(0.55 * nx + 0.75 * ny);
      const spec = Math.hypot(nx + 0.4, ny + 0.45) < 0.28 ? 0.35 : 0;
      ctx.fillStyle = light > 0
        ? `rgba(255, 255, 255, ${light * 0.22 + spec})`
        : `rgba(0, 0, 0, ${-light * 0.4})`;
      ctx.fillRect(x, y, cell - 1, cell - 1);

      // Lighten the outer ring so the piece's edge stands out
      if (edge) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x, y, cell - 1, cell - 1);
      }
    }
  }
  discCache.set(key, img);
  return img;
}

export class Game {
  constructor(width, height, numPlayers, inputManager, onGameOver, difficulty = 'hard') {
    this.width = width;
    this.height = height;
    this.numPlayers = numPlayers;
    this.inputManager = inputManager;
    this.onGameOver = onGameOver;

    this.score = { team1: 0, team2: 0, team3: 0 };
    this.winningScore = Settings.WINNING_SCORE;

    // Difficulty scaling — speed scales with screen size so crossing time stays consistent across devices
    this.baseSpeed = Settings.BASE_SPEED * (Math.min(width, height) / Settings.REFERENCE_SIZE);
    this.speedMultiplier = 1.0;
    this.maxSpeed = Settings.MAX_SPEED;
    this.pusherRadius = Math.min(width, height) * Settings.PUSHER_RADIUS_FRACTION;
    const initialGoalSize = Math.min(width, height) * Settings.GOAL_SIZE_FRACTION;
    this.goalSizes = { team1: initialGoalSize, team2: initialGoalSize, team3: initialGoalSize };
    this.goalDepth = Math.min(width * 0.07, Settings.MAX_GOAL_DEPTH);
    this.goalOffset = Math.min(width, height) * 0.25;
    this.puckRadius = Math.min(width, height) * Settings.PUCK_RADIUS_FRACTION;
    this.splitInterval = Settings.SPLIT_INTERVAL;

    this.pucks = [];
    this.pushers = [];
    this.maxPucks = Settings.MAX_PUCKS;

    // Pixel blocks bursting out of a goal after a score
    this.goalPixels = [];
    // Seconds into the pushers' pop-in animation, or null once they're in play.
    // Negative keeps them hidden (while the team-name intro runs).
    this.pusherAppear = null;

    this.powerUp = null; // { type: 'speed' | 'cross', timeLeft, fx, fy } while a drop is on the board
    this.powerUpSpawnTimer = this.randomPowerUpDelay();

    this.aiController = new AIController(AI_DIFFICULTY[difficulty] ?? AI_DIFFICULTY.hard);

    this.initPlayers();

    // Start with one initial puck in the center moving randomly
    this.spawnPuck(width / 2, height / 2, true);
  }

  onResize(width, height) {
    this.width = width;
    this.height = height;
    this.goalOffset = Math.min(width, height) * 0.25;
  }

  initPlayers() {
    if (this.numPlayers === 1) {
      // 1 player vs AI
      this.pushers.push(this.createPusher(this.width * 0.25, this.height / 2, 1, [0, 1], false)); // Human Left
      this.pushers.push(this.createPusher(this.width * 0.75, this.height / 2, 2, [2, 3], true)); // AI Right
    } else if (this.numPlayers === 2) {
      // 2 players: 1 on left, 1 on right
      this.pushers.push(this.createPusher(this.width * 0.25, this.height / 2, 1, [0, 1], false));
      this.pushers.push(this.createPusher(this.width * 0.75, this.height / 2, 2, [2, 3], false));
    } else if (this.numPlayers === 3) {
      // 3 players: Radial split (Left, Right, Top)
      this.pushers.push(this.createPusher(this.width * 0.25, this.height * 0.75, 1, [1])); // Left Zone
      this.pushers.push(this.createPusher(this.width * 0.75, this.height * 0.75, 2, [2])); // Right Zone
      this.pushers.push(this.createPusher(this.width * 0.5, this.height * 0.25, 3, [0])); // Top Zone
    } else {
      // 4 players: 1 per quadrant
      this.pushers.push(this.createPusher(this.width * 0.25, this.height * 0.25, 1, [0])); // TL
      this.pushers.push(this.createPusher(this.width * 0.25, this.height * 0.75, 1, [1])); // BL
      this.pushers.push(this.createPusher(this.width * 0.75, this.height * 0.25, 2, [2])); // TR
      this.pushers.push(this.createPusher(this.width * 0.75, this.height * 0.75, 2, [3])); // BR
    }
  }

  createPusher(x, y, team, quadrants, isAI = false) {
    return {
      x, y, vx: 0, vy: 0, radius: this.pusherRadius, team, quadrants, mass: Infinity, isAI,
      stamina: 1, staminaRegenDelay: 0, boostTimer: 0,
      crossTimer: 0, returningHome: false,
    };
  }

  // Current top speed for a pusher, interpolated between the exhausted and
  // full-stamina caps (or the power-up speed while boosted).
  pusherSpeedCap(pusher) {
    const unit = this.baseSpeed * this.speedMultiplier;
    if (pusher.boostTimer > 0) return unit * Settings.POWERUP_SPEED_FACTOR;
    const factor = Settings.PUSHER_EXHAUSTED_SPEED_FACTOR +
      (Settings.PUSHER_MAX_SPEED_FACTOR - Settings.PUSHER_EXHAUSTED_SPEED_FACTOR) * pusher.stamina;
    return unit * factor;
  }

  randomPowerUpDelay() {
    const min = Settings.POWERUP_SPAWN_MIN_DELAY;
    return min + Math.random() * (Settings.POWERUP_SPAWN_MAX_DELAY - min);
  }

  // Pick a random point on the center line(s) dividing the zones, returned as
  // fractions of width/height so it follows resizes. Lines map to lines under
  // that scaling, so the point stays on the boundary.
  randomPowerUpPosition() {
    const margin = Settings.POWERUP_LINE_MARGIN;
    if (this.numPlayers !== 3) {
      // Vertical centerline, kept clear of the top and bottom walls
      return { fx: 0.5, fy: margin + Math.random() * (1 - 2 * margin) };
    }

    // 3-player: one of the three spokes running from the radial junction to the
    // edge, chosen in proportion to its on-screen length so drops are spread
    // evenly, and kept clear of the far wall/corner.
    const sy = Settings.THREE_PLAYER_SPLIT_Y_FRACTION;
    const spokes = [[0.5, 1], [0, 0], [1, 0]].map(([ex, ey]) => ({
      ex, ey, len: Math.hypot((ex - 0.5) * this.width, (ey - sy) * this.height),
    }));
    let pick = Math.random() * spokes.reduce((sum, s) => sum + s.len, 0);
    const spoke = spokes.find(s => (pick -= s.len) <= 0) ?? spokes[0];
    const t = Math.random() * (1 - margin);
    return { fx: 0.5 + (spoke.ex - 0.5) * t, fy: sy + (spoke.ey - sy) * t };
  }

  getPowerUpGeometry() {
    return {
      x: this.width * this.powerUp.fx,
      y: this.height * this.powerUp.fy,
      radius: Math.min(this.width, this.height) * Settings.POWERUP_RADIUS_FRACTION,
    };
  }

  // Spawn, expire and collect drops. The first pusher to touch one gets its
  // power-up; drops sit on the center line, as far from every goal as a pusher
  // can go, so grabbing one means leaving the goal open.
  updatePowerUp(dt) {
    if (!this.powerUp) {
      this.powerUpSpawnTimer -= dt;
      if (this.powerUpSpawnTimer <= 0) {
        this.powerUp = {
          type: Math.random() < Settings.POWERUP_CROSS_CHANCE ? 'cross' : 'speed',
          timeLeft: Settings.POWERUP_LIFETIME,
          ...this.randomPowerUpPosition(),
        };
      }
      return;
    }

    this.powerUp.timeLeft -= dt;
    if (this.powerUp.timeLeft <= 0) {
      this.powerUp = null;
      this.powerUpSpawnTimer = this.randomPowerUpDelay();
      return;
    }

    // Can't be grabbed until it has finished dropping in
    if (Settings.POWERUP_LIFETIME - this.powerUp.timeLeft < powerUpDropTime(this.powerUp.type)) return;

    const { x, y, radius } = this.getPowerUpGeometry();
    for (const pusher of this.pushers) {
      if (Math.hypot(pusher.x - x, pusher.y - y) > radius + pusher.radius) continue;

      if (this.powerUp.type === 'cross') {
        pusher.crossTimer = Settings.CROSS_DURATION;
        pusher.returningHome = false;
      } else {
        pusher.boostTimer = Settings.POWERUP_DURATION;
        pusher.stamina = 1;
      }
      this.powerUp = null;
      this.powerUpSpawnTimer = this.randomPowerUpDelay();
      return;
    }
  }

  // Drain stamina in proportion to how fast the pusher actually moved this
  // frame (after constraints), and regenerate it only while standing still.
  updateStamina(pusher, dt) {
    if (dt <= 0) return;
    if (pusher.returningHome) return; // the forced glide home shouldn't cost stamina
    if (pusher.boostTimer > 0) {
      // Boosted: stamina stays full for the whole power-up
      pusher.boostTimer = Math.max(0, pusher.boostTimer - dt);
      pusher.stamina = 1;
      return;
    }
    if (pusher.crossTimer > 0) return; // crossing the line freezes stamina where it was
    const unit = this.baseSpeed * this.speedMultiplier;
    const speed = Math.hypot(pusher.x - pusher.prevX, pusher.y - pusher.prevY) / dt;
    const maxSpeed = unit * Settings.PUSHER_MAX_SPEED_FACTOR;

    const threePlayer = this.numPlayers === 3;
    const drainRate = threePlayer ? Settings.THREE_PLAYER_STAMINA_DRAIN_RATE : Settings.STAMINA_DRAIN_RATE;
    const regenRate = threePlayer ? Settings.THREE_PLAYER_STAMINA_REGEN_RATE : Settings.STAMINA_REGEN_RATE;

    if (speed > 0) {
      const effort = Math.min(1, speed / maxSpeed);
      pusher.stamina = Math.max(0, pusher.stamina - effort * drainRate * dt);
      pusher.staminaRegenDelay = Settings.STAMINA_REGEN_DELAY;
    } else if (pusher.staminaRegenDelay > 0) {
      pusher.staminaRegenDelay -= dt;
    } else {
      pusher.stamina = Math.min(1, pusher.stamina + regenRate * dt);
    }
  }

  spawnPuck(x, y, randomVelocity = false, team = null) {
    if (this.pucks.length >= this.maxPucks) return;
    let vx = 0;
    let vy = 0;
    if (randomVelocity) {
      const angle = Math.random() * Math.PI * 2;
      vx = Math.cos(angle) * this.baseSpeed;
      vy = Math.sin(angle) * this.baseSpeed;
    }

    let validSpawn = false;
    let attempts = 0;
    let spawnX = x;
    let spawnY = y;

    while (!validSpawn && attempts < 20) {
      validSpawn = true;
      for (const p of this.pucks) {
        if (Math.hypot(p.x - spawnX, p.y - spawnY) < this.puckRadius * 2.5) {
          validSpawn = false;
          break;
        }
      }
      if (validSpawn) {
        for (const p of this.pushers) {
          if (Math.hypot(p.x - spawnX, p.y - spawnY) < this.puckRadius + p.radius + 10) {
            validSpawn = false;
            break;
          }
        }
      }

      if (!validSpawn) {
        // shift randomly within a radius
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetDist = this.puckRadius * 3;
        spawnX += Math.cos(offsetAngle) * offsetDist;
        spawnY += Math.sin(offsetAngle) * offsetDist;
        // Keep in bounds roughly
        spawnX = Math.max(this.puckRadius, Math.min(this.width - this.puckRadius, spawnX));
        spawnY = Math.max(this.puckRadius, Math.min(this.height - this.puckRadius, spawnY));
      }
      attempts++;
    }

    this.pucks.push({
      x: spawnX, y: spawnY, vx, vy, radius: this.puckRadius, mass: 1,
      team, lastHitTeam: team,
      timeSinceLastSplit: 0,
      speedBoost: 0,
    });
  }

  onGoalScored(goalTeam, lastHitTeam, puckX, puckY, wall = null) {
    // Burst a shower of pixels in the scoring player's color from the goal mouth
    this.spawnGoalPixels(this.getColor(lastHitTeam || goalTeam), wall, puckX, puckY);

    if (this.numPlayers === 3) {
      if (goalTeam === lastHitTeam || !lastHitTeam) {
        // Hit into own goal, others get points
        if (goalTeam !== 1) this.score.team1++;
        if (goalTeam !== 2) this.score.team2++;
        if (goalTeam !== 3) this.score.team3++;
      } else {
        // Hit into someone else's goal, the hitter gets a point
        if (lastHitTeam === 1) this.score.team1++;
        if (lastHitTeam === 2) this.score.team2++;
        if (lastHitTeam === 3) this.score.team3++;
      }
    } else {
      // 2 or 4 player logic (team 1 vs team 2)
      const scoringTeam = goalTeam === 1 ? 2 : 1;
      if (scoringTeam === 1) this.score.team1++;
      else this.score.team2++;
    }

    if (this.score.team1 >= this.winningScore) return this.onGameOver(1);
    if (this.score.team2 >= this.winningScore) return this.onGameOver(2);
    if (this.score.team3 >= this.winningScore) return this.onGameOver(3);

    // Difficulty scaling
    this.speedMultiplier += Settings.SPEED_MULTIPLIER_INCREMENT;

    // Shrink puck radius by 3% on each goal (minimum 1% of screen)
    const minPuckRadius = Math.min(this.width, this.height) * Settings.MIN_PUCK_RADIUS_FRACTION;
    this.puckRadius = Math.max(minPuckRadius, this.puckRadius * Settings.PUCK_RADIUS_SHRINK);
    this.pucks.forEach(p => p.radius = Math.max(minPuckRadius, p.radius * Settings.PUCK_RADIUS_SHRINK));

    const scorerTeam = this.numPlayers === 3
      ? (lastHitTeam && lastHitTeam !== goalTeam ? lastHitTeam : null)
      : (goalTeam === 1 ? 2 : 1);

    if (scorerTeam) {
      const minPusherRadius = Math.min(this.width, this.height) * Settings.MIN_PUSHER_RADIUS_FRACTION;
      this.pushers.forEach(p => {
        if (p.team === scorerTeam) {
          p.radius = Math.max(minPusherRadius, p.radius * Settings.PUSHER_RADIUS_SHRINK);
        }
      });

      const key = `team${scorerTeam}`;
      const maxGoalSize = Math.max(this.width, this.height) * Settings.MAX_GOAL_SIZE_FRACTION;
      this.goalSizes[key] = Math.min(maxGoalSize, this.goalSizes[key] * Settings.GOAL_SIZE_GROWTH);
    }

    // Previously we spawned new pucks on score; now splitting handles extra balls.

    // If all pucks have been removed (all went into goals), spawn a new one in the center
    if (this.pucks.length === 0) {
      this.spawnPuck(this.width / 2, this.height / 2, true);
    }
  }

  // Keep a pusher inside its own zone (half, quadrant or 3-player wedge).
  constrainToZone(pusher) {
    if (this.numPlayers === 3) {
      this.constrainPusherRadial(pusher);
      return;
    }
    const midX = this.width / 2;
    const midY = this.height / 2;
    let minX = pusher.team === 1 ? 0 : midX;
    let maxX = pusher.team === 1 ? midX : this.width;
    let minY = 0;
    let maxY = this.height;

    if (this.numPlayers === 4) {
      if (pusher.quadrants.includes(0) || pusher.quadrants.includes(2)) maxY = midY;
      if (pusher.quadrants.includes(1) || pusher.quadrants.includes(3)) minY = midY;
    }

    constrainPusher(pusher, minX, maxX, minY, maxY);
  }

  // Push a crossing pusher out of any pusher it overlaps (only it moves).
  separateFromPushers(pusher) {
    for (const other of this.pushers) {
      if (other === pusher) continue;
      const dx = pusher.x - other.x;
      const dy = pusher.y - other.y;
      const dist = Math.hypot(dx, dy);
      const minDist = pusher.radius + other.radius;
      if (dist >= minDist) continue;
      const nx = dist > 1e-9 ? dx / dist : 1;
      const ny = dist > 1e-9 ? dy / dist : 0;
      pusher.x = other.x + nx * minDist;
      pusher.y = other.y + ny * minDist;
    }
  }

  // After a cross power-up ends, steer the pusher back to the nearest point in
  // its zone at a fixed speed (ignoring input) rather than snapping it there.
  glideHome(pusher, dt) {
    const home = { x: pusher.x, y: pusher.y, radius: pusher.radius, team: pusher.team, quadrants: pusher.quadrants };
    this.constrainToZone(home);
    const dx = home.x - pusher.x;
    const dy = home.y - pusher.y;
    const dist = Math.hypot(dx, dy);
    const speed = this.baseSpeed * this.speedMultiplier * Settings.CROSS_RETURN_SPEED_FACTOR;
    const step = speed * dt;

    if (dist <= step) {
      pusher.x = home.x;
      pusher.y = home.y;
      pusher.vx = 0;
      pusher.vy = 0;
      pusher.returningHome = false;
      return;
    }
    pusher.vx = (dx / dist) * speed;
    pusher.vy = (dy / dist) * speed;
    pusher.x += (dx / dist) * step;
    pusher.y += (dy / dist) * step;
  }

  constrainPusherRadial(pusher) {
    const cx = this.width / 2;
    const cy = this.height * Settings.THREE_PLAYER_SPLIT_Y_FRACTION;
    let minX = pusher.radius;
    let maxX = this.width - pusher.radius;
    let minY = pusher.radius;
    let maxY = this.height - pusher.radius;

    // Hard bounds on the whole screen
    if (pusher.x < minX) pusher.x = minX;
    if (pusher.x > maxX) pusher.x = maxX;
    if (pusher.y < minY) pusher.y = minY;
    if (pusher.y > maxY) pusher.y = maxY;

    // Radial bounds
    if (pusher.team === 1) { // Left
      if (pusher.x > cx - pusher.radius) pusher.x = cx - pusher.radius;
      const tlLineY = (cy / cx) * pusher.x;
      if (pusher.y < tlLineY + pusher.radius) pusher.y = tlLineY + pusher.radius;
    } else if (pusher.team === 2) { // Right
      if (pusher.x < cx + pusher.radius) pusher.x = cx + pusher.radius;
      const trLineY = (cy / cx) * (this.width - pusher.x);
      if (pusher.y < trLineY + pusher.radius) pusher.y = trLineY + pusher.radius;
    } else if (pusher.team === 3) { // Top
      if (pusher.y > cy - pusher.radius) pusher.y = cy - pusher.radius;
      const tlLineY = (cy / cx) * pusher.x;
      const trLineY = (cy / cx) * (this.width - pusher.x);
      if (pusher.y > tlLineY - pusher.radius) pusher.y = tlLineY - pusher.radius;
      if (pusher.y > trLineY - pusher.radius) pusher.y = trLineY - pusher.radius;
    }
  }

  spawnRandomPuckAwayFromGoal() {
    if (this.pucks.length >= this.maxPucks) return;

    const margin = Math.min(this.width, this.height) * 0.2;
    const x = margin + Math.random() * (this.width - margin * 2);
    const y = margin + Math.random() * (this.height - margin * 2);

    let goals = [];
    const cx = this.width / 2;
    const cy = this.height / 2;

    if (this.numPlayers === 3) {
      const d = this.goalOffset;
      const cx = this.width / 2;
      goals.push({ x: 0, y: d });               // Team 1 left wall
      goals.push({ x: cx - d, y: this.height }); // Team 1 bottom wall
      goals.push({ x: this.width, y: d });       // Team 2 right wall
      goals.push({ x: cx + d, y: this.height }); // Team 2 bottom wall
      goals.push({ x: d, y: 0 });               // Team 3 top wall left
      goals.push({ x: this.width - d, y: 0 });  // Team 3 top wall right
    } else if (this.numPlayers === 4) {
      // Whole side walls are goals, so the nearest goal point is straight across
      goals.push({ x: 0, y });
      goals.push({ x: this.width, y });
    } else {
      goals.push({ x: 0, y: 0 });
      goals.push({ x: 0, y: this.height });
      goals.push({ x: this.width, y: 0 });
      goals.push({ x: this.width, y: this.height });
    }

    let closestGoal = goals[0];
    let minDist = Infinity;
    for (const g of goals) {
      const dist = Math.hypot(g.x - x, g.y - y);
      if (dist < minDist) {
        minDist = dist;
        closestGoal = g;
      }
    }

    const dx = x - closestGoal.x;
    const dy = y - closestGoal.y;
    let angle = Math.atan2(dy, dx);
    angle += (Math.random() - 0.5) * Math.PI / 2;

    const currentSpeed = this.baseSpeed * this.speedMultiplier;
    const vx = Math.cos(angle) * currentSpeed;
    const vy = Math.sin(angle) * currentSpeed;

    this.pucks.push({
      x, y, vx, vy, radius: this.puckRadius, mass: 1,
      team: null, lastHitTeam: null,
      timeSinceLastSplit: 0,
      speedBoost: 0,
    });
  }

  spawnGoalPixels(color, wall, x, y) {
    // Direction pointing away from the wall, into the field
    const inward = { left: 0, right: Math.PI, top: Math.PI / 2, bottom: -Math.PI / 2 }[wall];
    if (inward === undefined) return;
    const scale = Math.min(this.width, this.height);
    const spread = this.puckRadius * 1.3;
    for (let i = 0; i < 48; i++) {
      const angle = inward + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = scale * (0.3 + Math.random() * 0.9);
      const offset = (Math.random() - 0.5) * 2 * spread;
      const life = 0.6 + Math.random() * 0.6;
      this.goalPixels.push({
        x: x + Math.cos(inward + Math.PI / 2) * offset,
        y: y + Math.sin(inward + Math.PI / 2) * offset,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life,
        // Mostly the scorer's color, with a few white sparks mixed in
        color: Math.random() < 0.2 ? '#ffffff' : color,
      });
    }
  }

  updateGoalPixels(dt) {
    const drag = Math.exp(-3 * dt);
    for (const p of this.goalPixels) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.age += dt;
    }
    this.goalPixels = this.goalPixels.filter(p => p.age < p.life);
  }

  update(dt) {
    this.updateGoalPixels(dt);

    // 1. Update pushers from input.
    // Record where each pusher started so the physics step can sweep it along
    // its path (a fast paddle must not tunnel through a puck).
    for (const pusher of this.pushers) {
      pusher.prevX = pusher.x;
      pusher.prevY = pusher.y;

      if (pusher.crossTimer > 0) {
        pusher.crossTimer = Math.max(0, pusher.crossTimer - dt);
        if (pusher.crossTimer === 0) pusher.returningHome = true;
      }

      if (pusher.returningHome) {
        this.glideHome(pusher, dt);
      } else if (pusher.isAI) {
        this.aiController.update(pusher, this.pucks, {
          width: this.width,
          height: this.height,
          goalSizes: this.goalSizes,
          baseSpeed: this.baseSpeed,
          speedMultiplier: this.speedMultiplier,
          maxSpeed: this.pusherSpeedCap(pusher),
          powerUp: this.powerUp ? this.getPowerUpGeometry() : null,
        }, dt);
      } else {
        let activeTouch = null;
        for (const q of pusher.quadrants) {
          const touch = this.inputManager.getTouchForQuadrant(q);
          if (touch) {
            activeTouch = touch;
            break;
          }
        }

        if (activeTouch) {
          // Spring-damper approach for inertia and slight overshoot
          const targetX = activeTouch.x;
          const targetY = activeTouch.y;
          const dx = targetX - pusher.x;
          const dy = targetY - pusher.y;

          // Tunable constants (pixels/s^2 and damping)
          const stiffness = Math.max(400, this.baseSpeed * 4 * this.speedMultiplier); // spring constant
          const damping = Math.max(18, this.baseSpeed * 0.12 * this.speedMultiplier); // damping coefficient

          // Spring force toward target minus damping proportional to velocity
          const ax = dx * stiffness - pusher.vx * damping;
          const ay = dy * stiffness - pusher.vy * damping;

          // Integrate acceleration to velocity
          pusher.vx += ax * dt;
          pusher.vy += ay * dt;

          // Cap velocity by the stamina-dependent top speed
          const maxSpeed = this.pusherSpeedCap(pusher);
          const vs = Math.hypot(pusher.vx, pusher.vy);
          if (vs > maxSpeed) {
            pusher.vx = (pusher.vx / vs) * maxSpeed;
            pusher.vy = (pusher.vy / vs) * maxSpeed;
          }

          // Integrate position
          pusher.x += pusher.vx * dt;
          pusher.y += pusher.vy * dt;

          // Snap if extremely close and nearly stationary to avoid jitter
          const remaining = Math.hypot(targetX - pusher.x, targetY - pusher.y);
          if (remaining <= 3 && Math.hypot(pusher.vx, pusher.vy) < 30) {
            pusher.x = targetX;
            pusher.y = targetY;
            pusher.vx = 0;
            pusher.vy = 0;
          }
        } else {
          // No touch: apply damping to slowly come to rest (natural friction)
          const stopDamping = Math.max(6, this.baseSpeed * 0.08 * this.speedMultiplier);
          pusher.vx -= pusher.vx * Math.min(1, stopDamping * dt);
          pusher.vy -= pusher.vy * Math.min(1, stopDamping * dt);
          pusher.x += pusher.vx * dt;
          pusher.y += pusher.vy * dt;

          // Small threshold to zero out
          if (Math.hypot(pusher.vx, pusher.vy) < 4) {
            pusher.vx = 0;
            pusher.vy = 0;
          }
        }
      }

      if (pusher.crossTimer > 0 || pusher.returningHome) {
        // Crossing (or on the way back): only the outer walls apply. While
        // crossing, the invader can't sit on top of other pushers; it passes
        // through them on the way home so it can never get stuck outside.
        if (!pusher.returningHome) this.separateFromPushers(pusher);
        constrainPusher(pusher, 0, this.width, 0, this.height);
      } else {
        this.constrainToZone(pusher);
      }

      // Final (constrained) position for this frame; the physics step sweeps
      // the pusher from prevX/prevY to here.
      pusher.finalX = pusher.x;
      pusher.finalY = pusher.y;

      this.updateStamina(pusher, dt);
    }

    // 2b. Periodic splitting: each puck splits in two every splitInterval seconds
    const currentPucks = Array.from(this.pucks);
    for (const puck of currentPucks) {
      puck.timeSinceLastSplit = (puck.timeSinceLastSplit || 0) + dt;
      // Pre-split throb speeds up from 2 to 12 beats/sec as the split nears
      const warn = Math.max(0, 1 - this.splitTimeLeft(puck) / Settings.SPLIT_WARNING_TIME);
      puck.throbPhase = warn > 0 ? (puck.throbPhase || 0) + dt * 2 * Math.PI * (2 + 10 * warn) : 0;
      if (puck.timeSinceLastSplit >= this.splitInterval) {
        puck.timeSinceLastSplit = 0;
        if (this.pucks.length < this.maxPucks) {
          this.splitPuck(puck);
        }
      }
    }

    // 3. Physics: move pucks, bounce them off walls, pushers and each other.
    // Sub-stepped so a fast puck cannot tunnel through anything in one frame.
    this.stepPhysics(dt);

    this.updatePowerUp(dt);
  }

  // Sub-stepped physics integration. Pucks travel at a constant speed; every
  // sub-step advances them a little, sweeps the pushers along their path, then
  // resolves puck/wall, puck/pusher and puck/puck collisions. Splitting the
  // frame keeps per-step motion below a puck radius so nothing tunnels through.
  stepPhysics(dt) {
    const targetSpeed = this.baseSpeed * this.speedMultiplier;

    // Normalize puck speeds, incorporating any active speed boost from momentum.
    for (const puck of this.pucks) {
      if (puck.speedBoost > 0) {
        puck.speedBoost = Math.max(0, puck.speedBoost * Math.exp(-Settings.MOMENTUM_DECAY * dt));
      }
      this.setPuckSpeed(puck, targetSpeed + puck.speedBoost);
    }

    // Choose a sub-step count from the fastest mover (puck or pusher) so that
    // no body advances more than half the smallest puck radius per sub-step.
    let maxTravel = targetSpeed * dt;
    let minRadius = this.puckRadius;
    for (const puck of this.pucks) minRadius = Math.min(minRadius, puck.radius);
    for (const pusher of this.pushers) {
      maxTravel = Math.max(maxTravel, Math.hypot(pusher.finalX - pusher.prevX, pusher.finalY - pusher.prevY));
    }
    const safeStep = Math.max(1, minRadius * 0.5);
    const steps = Math.max(1, Math.min(Settings.MAX_SUBSTEPS, Math.ceil(maxTravel / safeStep)));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      const t = (s + 1) / steps;

      // Sweep pushers from their start to their final position for this frame.
      for (const pusher of this.pushers) {
        pusher.x = pusher.prevX + (pusher.finalX - pusher.prevX) * t;
        pusher.y = pusher.prevY + (pusher.finalY - pusher.prevY) * t;
      }

      // Advance pucks.
      for (const puck of this.pucks) {
        puck.x += puck.vx * sdt;
        puck.y += puck.vy * sdt;
      }

      // Walls and goals. Collect goals and apply them after the collision pass.
      const scored = [];
      for (let i = this.pucks.length - 1; i >= 0; i--) {
        const puck = this.pucks[i];
        const goalResult = this.handlePuckWalls(puck);
        if (goalResult !== 0) {
          this.pucks.splice(i, 1);
          scored.push({ goalTeam: goalResult.team, wall: goalResult.wall, lastHit: puck.lastHitTeam, x: puck.x, y: puck.y });
        }
      }

      // Puck vs Pusher (pushers are immovable, so only the puck reacts).
      for (const puck of this.pucks) {
        for (const pusher of this.pushers) {
          const hit = resolveCircleCollision(pusher, puck, 1.0);
          if (hit) {
            puck.lastHitTeam = pusher.team;
            // Guarantee the puck peels off the pusher instead of orbiting its
            // rim: a grazing hit produces almost no normal impulse, so force a
            // minimum outward speed (measured relative to the moving pusher).
            // This must run for EVERY contact (including ones the solver treats
            // as "already separating"), otherwise the puck slides along the edge.
            const dx = puck.x - pusher.x;
            const dy = puck.y - pusher.y;
            const d = Math.hypot(dx, dy) || 1;
            const nx = dx / d;
            const ny = dy / d;
            const relOut = (puck.vx - pusher.vx) * nx + (puck.vy - pusher.vy) * ny;
            const minOut = targetSpeed * Settings.PUSHER_MIN_DEFLECT;
            if (relOut < minOut) {
              const add = minOut - relOut;
              puck.vx += nx * add;
              puck.vy += ny * add;
            }

            if (Settings.BALL_MOMENTUM) {
              const pusherNormal = pusher.vx * nx + pusher.vy * ny;
              if (pusherNormal > 0) {
                const boost = pusherNormal * Settings.MOMENTUM_TRANSFER;
                const maxBoost = targetSpeed * Settings.MOMENTUM_MAX_BOOST_FACTOR;
                puck.speedBoost = Math.min(maxBoost, puck.speedBoost + boost);
              }
            }
          }
        }
      }

      // Puck vs Puck.
      for (let i = 0; i < this.pucks.length; i++) {
        for (let j = i + 1; j < this.pucks.length; j++) {
          const p1 = this.pucks[i];
          const p2 = this.pucks[j];
          if (resolveCircleCollision(p1, p2, 1.0)) {
            const temp = p1.lastHitTeam;
            p1.lastHitTeam = p2.lastHitTeam || p1.lastHitTeam;
            p2.lastHitTeam = temp || p2.lastHitTeam;
          }
        }
      }

      // Final guarantee: a puck must never be left overlapping a pusher (a
      // puck-vs-puck push above can shove one back in). Move it straight out
      // along the contact normal so it sits flush against the pusher's edge.
      for (const puck of this.pucks) {
        for (const pusher of this.pushers) {
          const dx = puck.x - pusher.x;
          const dy = puck.y - pusher.y;
          const minDist = pusher.radius + puck.radius;
          const d = Math.hypot(dx, dy);
          if (d < minDist) {
            const nx = d > 1e-9 ? dx / d : 1;
            const ny = d > 1e-9 ? dy / d : 0;
            puck.x = pusher.x + nx * minDist;
            puck.y = pusher.y + ny * minDist;
          }
        }
      }

      // Collisions only change direction — restore the constant puck speed.
      for (const puck of this.pucks) this.setPuckSpeed(puck, targetSpeed);

      for (const sc of scored) {
        this.onGoalScored(sc.goalTeam, sc.lastHit, sc.x, sc.y, sc.wall);
      }
    }

    // Leave pushers at their final position for rendering and next frame.
    for (const pusher of this.pushers) {
      pusher.x = pusher.finalX;
      pusher.y = pusher.finalY;
    }
  }

  // Rescale a puck's velocity to the given speed, giving it a random heading
  // if it has somehow come to rest.
  setPuckSpeed(puck, speed) {
    const sp = Math.hypot(puck.vx, puck.vy);
    if (sp > 1e-6) {
      puck.vx = (puck.vx / sp) * speed;
      puck.vy = (puck.vy / sp) * speed;
    } else {
      const angle = Math.random() * Math.PI * 2;
      puck.vx = Math.cos(angle) * speed;
      puck.vy = Math.sin(angle) * speed;
    }
  }

  // Reflect a puck off the arena walls, or return the team whose goal it
  // entered (0 if it stays in play). Velocity is set to point away from the
  // wall rather than simply negated, so a puck grazing the wall across several
  // sub-steps can't get its velocity flipped twice and stick.
  handlePuckWalls(puck) {
    if (this.numPlayers === 3) {
      const d = this.goalOffset;
      const cx = this.width / 2;

      // Left Wall — Team 1: one goal at y=d (adjacent to Team 3 boundary at top-left corner)
      if (puck.x - puck.radius < 0) {
        const g1 = this.goalSizes.team1;
        if (puck.y > d - g1 / 2 && puck.y < d + g1 / 2) {
          return { team: 1, wall: 'left' };
        } else {
          puck.x = puck.radius;
          puck.vx = Math.abs(puck.vx);
        }
      }
      // Right Wall — Team 2: one goal at y=d (adjacent to Team 3 boundary at top-right corner)
      if (puck.x + puck.radius > this.width) {
        const g2 = this.goalSizes.team2;
        if (puck.y > d - g2 / 2 && puck.y < d + g2 / 2) {
          return { team: 2, wall: 'right' };
        } else {
          puck.x = this.width - puck.radius;
          puck.vx = -Math.abs(puck.vx);
        }
      }
      // Top Wall — Team 3: two goals at x=d and x=width-d
      if (puck.y - puck.radius < 0) {
        const g3 = this.goalSizes.team3;
        const inA = puck.x > d - g3 / 2 && puck.x < d + g3 / 2;
        const inB = puck.x > (this.width - d) - g3 / 2 && puck.x < (this.width - d) + g3 / 2;
        if (inA || inB) {
          return { team: 3, wall: 'top' };
        } else {
          puck.y = puck.radius;
          puck.vy = Math.abs(puck.vy);
        }
      }
      // Bottom Wall — Team 1 goal at x=cx-d, Team 2 goal at x=cx+d (adjacent to Team 1/2 boundary at bottom-center)
      if (puck.y + puck.radius > this.height) {
        const g1 = this.goalSizes.team1;
        const g2 = this.goalSizes.team2;
        if (puck.x > (cx - d) - g1 / 2 && puck.x < (cx - d) + g1 / 2) {
          return { team: 1, wall: 'bottom' };
        } else if (puck.x > (cx + d) - g2 / 2 && puck.x < (cx + d) + g2 / 2) {
          return { team: 2, wall: 'bottom' };
        } else {
          puck.y = this.height - puck.radius;
          puck.vy = -Math.abs(puck.vy);
        }
      }
    } else {
      // In 4-player the whole left and right edges are goals
      const fullEdge = this.numPlayers === 4;
      const g1 = this.goalSizes.team1;
      const g2 = this.goalSizes.team2;
      // Left Wall
      if (puck.x - puck.radius < 0) {
        if (fullEdge || puck.y < g1 || puck.y > this.height - g1) {
          return { team: 1, wall: 'left' };
        } else {
          puck.x = puck.radius;
          puck.vx = Math.abs(puck.vx);
        }
      }
      // Right Wall
      if (puck.x + puck.radius > this.width) {
        if (fullEdge || puck.y < g2 || puck.y > this.height - g2) {
          return { team: 2, wall: 'right' };
        } else {
          puck.x = this.width - puck.radius;
          puck.vx = -Math.abs(puck.vx);
        }
      }
      // Top/Bottom Walls
      if (puck.y - puck.radius < 0) {
        puck.y = puck.radius;
        puck.vy = Math.abs(puck.vy);
      }
      if (puck.y + puck.radius > this.height) {
        puck.y = this.height - puck.radius;
        puck.vy = -Math.abs(puck.vy);
      }
    }

    return 0;
  }

  // Advance the pusher pop-in; clears pusherAppear once the last one is in
  advancePusherAppear(dt) {
    this.pusherAppear += dt;
    const total = Settings.PUSHER_APPEAR_DURATION + Settings.PUSHER_APPEAR_STAGGER * (this.pushers.length - 1);
    if (this.pusherAppear >= total) this.pusherAppear = null;
  }

  getColor(team) {
    if (team === 1) return '#00ffff';
    if (team === 2) return '#ff00ff';
    if (team === 3) return '#ffff00';
    return '#ffffff';
  }

  // Each team's play area in screen pixels, for overlays drawn upright on top
  // of the board: { team, name, color, x, y (centre), width, height }.
  teamZonesOnScreen(canvasWidth, canvasHeight) {
    const W = this.width;
    const H = this.height;
    // Zones as centre + size in game coordinates
    const zones = this.numPlayers === 3
      ? [
        { team: 1, x: W * 0.25, y: H * 0.8, w: W * 0.5, h: H * 0.36 },
        { team: 2, x: W * 0.75, y: H * 0.8, w: W * 0.5, h: H * 0.36 },
        { team: 3, x: W * 0.5, y: H * 0.22, w: W * 0.55, h: H * 0.36 },
      ]
      : [
        { team: 1, x: W * 0.25, y: H / 2, w: W / 2, h: H },
        { team: 2, x: W * 0.75, y: H / 2, w: W / 2, h: H },
      ];

    // Portrait boards are drawn rotated -90° (see draw), which maps game
    // (x, y) to screen (y, canvasHeight - x) and swaps the zone's axes
    const portrait = canvasHeight > canvasWidth;
    const toScreen = (x, y) => (portrait ? { x: y, y: canvasHeight - x } : { x, y });
    return zones.map(z => ({
      team: z.team,
      name: `TEAM ${z.team}`,
      color: this.getColor(z.team),
      ...toScreen(z.x, z.y),
      width: portrait ? z.h : z.w,
      height: portrait ? z.w : z.h,
    }));
  }

  // Draw a round piece as a pixel-block disc (see getPixelDisc). Blocks are
  // a third of the goal block size, shrinking with small pieces so they stay round,
  // and are kept screen-aligned in portrait so the bevel lights from the top.
  drawPixelDisc(ctx, x, y, radius, fill, rim, portrait, dimFraction = 0) {
    const goalCell = Math.max(4, Math.round(this.goalDepth / 5));
    const cell = Math.max(2, Math.round(Math.min(goalCell / 3, radius / 6)));
    const r = Math.round(radius);
    const rows = 2 * Math.ceil(r / cell);
    const img = getPixelDisc(r, cell, fill, rim, Math.round(rows * dimFraction));
    ctx.save();
    ctx.translate(x, y);
    if (portrait) ctx.rotate(Math.PI / 2); // undo the board rotation
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round(-img.width / 2), Math.round(-img.height / 2));
    ctx.restore();
  }

  drawPusher(ctx, pusher, portrait) {
    const color = this.getColor(pusher.team);

    // Active power-ups: solid pusher with
    // an icon per power-up that drains as its time runs out.
    const active = [];
    if (pusher.boostTimer > 0) active.push({ type: 'speed', left: pusher.boostTimer / Settings.POWERUP_DURATION });
    if (pusher.crossTimer > 0) active.push({ type: 'cross', left: pusher.crossTimer / Settings.CROSS_DURATION });
    if (active.length > 0) {
      this.drawPixelDisc(ctx, pusher.x, pusher.y, pusher.radius, color, color, portrait);

      const iconSize = pusher.radius * (active.length > 1 ? 0.42 : 0.6);
      active.forEach((p, i) => {
        const offset = active.length > 1 ? (i === 0 ? -1 : 1) * pusher.radius * 0.42 : 0;
        this.drawDrainingIcon(ctx, p.type, pusher.x + offset, pusher.y, iconSize, p.left, portrait);
      });
      return;
    }

    // Stamina shown as a liquid level: the drained part is a dim shell inside
    // a solid rim, refilled from the bottom of the screen up as stamina recovers.
    const drained = Math.max(0, 1 - pusher.stamina);
    this.drawPixelDisc(ctx, pusher.x, pusher.y, pusher.radius, color, color, portrait, drained);
  }

  // Draw a goal as chunky pixel blocks to match the title and score text: a
  // pixelated half-ellipse D-zone with a brighter rim and a solid mouth along
  // the wall. `center` is the goal's position along `wall`, `size` its width.
  drawPixelGoal(ctx, wall, center, size, team) {
    const color = this.getColor(team);
    const cell = Math.max(4, Math.round(this.goalDepth / 5));
    const half = size / 2;
    const cols = Math.ceil(this.goalDepth / cell);
    const rows = Math.ceil(half / cell);
    // i counts cells inward from the wall, j cells along it from the centre
    const inside = (i, j) => {
      const u = (i + 0.5) * cell / this.goalDepth;
      const v = (j + 0.5) * cell / half;
      return u * u + v * v <= 1;
    };

    ctx.save();
    for (let i = 0; i < cols; i++) {
      for (let j = -rows; j < rows; j++) {
        if (!inside(i, j)) continue;
        const rim = !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
        ctx.globalAlpha = i === 0 ? 0.6 : rim ? 0.45 : 0.12;
        const u = i * cell;
        const v = center + j * cell;
        if (wall === 'left') drawBlock(ctx, u, v, cell, color, 0);
        else if (wall === 'right') drawBlock(ctx, this.width - u - cell, v, cell, color, 0);
        else if (wall === 'top') drawBlock(ctx, v, u, cell, color, 0);
        else drawBlock(ctx, v, this.height - u - cell, cell, color, 0);
      }
    }
    ctx.restore();
  }

  // Draw a goal spanning a whole side wall as a band of pixel blocks: a solid
  // mouth along the wall, a faint fill and a brighter rim at the goal depth.
  drawPixelEdgeGoal(ctx, wall, team) {
    const color = this.getColor(team);
    const cell = Math.max(4, Math.round(this.goalDepth / 5));
    const cols = Math.ceil(this.goalDepth / cell);
    const rows = Math.ceil(this.height / cell);
    const top = (this.height - rows * cell) / 2;

    ctx.save();
    for (let i = 0; i < cols; i++) {
      ctx.globalAlpha = i === 0 ? 0.6 : i === cols - 1 ? 0.45 : 0.12;
      const x = wall === 'left' ? i * cell : this.width - (i + 1) * cell;
      for (let j = 0; j < rows; j++) {
        drawBlock(ctx, x, top + j * cell, cell, color, 0);
      }
    }
    ctx.restore();
  }

  draw(ctx) {
    // When the physical canvas is portrait (height > width), rotate the drawing context
    // -90° so the landscape game layout fills the screen with goals maximally separated.
    const portrait = ctx.canvas.height > ctx.canvas.width;
    if (portrait) {
      ctx.save();
      ctx.translate(0, ctx.canvas.height);
      ctx.rotate(-Math.PI / 2);
    }

    ctx.clearRect(0, 0, this.width, this.height);

    const cx = this.width / 2;
    const cy = this.height / 2;

    if (this.numPlayers === 3) {
      const g1 = this.goalSizes.team1;
      const g2 = this.goalSizes.team2;
      const g3 = this.goalSizes.team3;
      const d = this.goalOffset;
      const splitY = this.height * Settings.THREE_PLAYER_SPLIT_Y_FRACTION;

      // Draw radial backgrounds
      // Team 1 (Left)
      ctx.fillStyle = 'rgba(0, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, splitY);
      ctx.lineTo(0, 0);
      ctx.lineTo(0, this.height);
      ctx.lineTo(cx, this.height);
      ctx.fill();

      // Team 2 (Right)
      ctx.fillStyle = 'rgba(255, 0, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, splitY);
      ctx.lineTo(this.width, 0);
      ctx.lineTo(this.width, this.height);
      ctx.lineTo(cx, this.height);
      ctx.fill();

      // Team 3 (Top)
      ctx.fillStyle = 'rgba(255, 255, 0, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, splitY);
      ctx.lineTo(0, 0);
      ctx.lineTo(this.width, 0);
      ctx.fill();

      // Draw radial lines
      ctx.beginPath();
      ctx.moveTo(cx, splitY);
      ctx.lineTo(cx, this.height); // Down
      ctx.moveTo(cx, splitY);
      ctx.lineTo(0, 0); // Top-left
      ctx.moveTo(cx, splitY);
      ctx.lineTo(this.width, 0); // Top-right
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Draw goals — two per team on different walls
      // Team 1: left wall goal at y=d (top, near Team3 boundary) + bottom wall goal at x=cx-d (near Team2 boundary)
      this.drawPixelGoal(ctx, 'left', d, g1, 1);
      this.drawPixelGoal(ctx, 'bottom', cx - d, g1, 1);
      // Team 2: right wall goal at y=d (top, near Team3 boundary) + bottom wall goal at x=cx+d (near Team2 boundary)
      this.drawPixelGoal(ctx, 'right', d, g2, 2);
      this.drawPixelGoal(ctx, 'bottom', cx + d, g2, 2);
      // Team 3 (top wall): goals at x=d and x=width-d
      this.drawPixelGoal(ctx, 'top', d, g3, 3);
      this.drawPixelGoal(ctx, 'top', this.width - d, g3, 3);
    } else {
      if (this.numPlayers === 4) {
        // Draw quadrant backgrounds for each player's area
        ctx.fillStyle = 'rgba(0, 255, 255, 0.07)'; // Team 1 top-left
        ctx.fillRect(0, 0, cx, cy);
        ctx.fillStyle = 'rgba(0, 255, 255, 0.04)'; // Team 1 bottom-left
        ctx.fillRect(0, cy, cx, cy);
        ctx.fillStyle = 'rgba(255, 0, 255, 0.07)'; // Team 2 top-right
        ctx.fillRect(cx, 0, cx, cy);
        ctx.fillStyle = 'rgba(255, 0, 255, 0.04)'; // Team 2 bottom-right
        ctx.fillRect(cx, cy, cx, cy);
      }

      // Draw center vertical line (team boundary) as a column of pixel blocks,
      // sized to match the goal pixels
      const cell = Math.max(4, Math.round(this.goalDepth / 5));
      const rows = Math.ceil(this.height / cell);
      const top = (this.height - rows * cell) / 2;
      for (let j = 0; j < rows; j++) {
        drawBlock(ctx, Math.round(cx - cell / 2), Math.round(top + j * cell), cell, '#333', 0);
      }

      if (this.numPlayers === 4) {
        // Draw horizontal center line (player boundary within each team) — dashed, subtler
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([12, 8]);
        ctx.moveTo(0, cy);
        ctx.lineTo(this.width, cy);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (this.numPlayers === 4) {
        // Goals span the whole left and right edges
        this.drawPixelEdgeGoal(ctx, 'left', 1);
        this.drawPixelEdgeGoal(ctx, 'right', 2);
      } else {
        // Draw goals in the corners, with their D-zones
        const g1 = this.goalSizes.team1;
        const g2 = this.goalSizes.team2;
        this.drawPixelGoal(ctx, 'left', g1 / 2, g1, 1);
        this.drawPixelGoal(ctx, 'left', this.height - g1 / 2, g1, 1);
        this.drawPixelGoal(ctx, 'right', g2 / 2, g2, 2);
        this.drawPixelGoal(ctx, 'right', this.height - g2 / 2, g2, 2);
      }
    }

    // Draw the goal pixel shower, snapped to the same grid as the goal blocks
    if (this.goalPixels.length > 0) {
      const cell = Math.max(4, Math.round(this.goalDepth / 5));
      ctx.save();
      for (const p of this.goalPixels) {
        const t = p.age / p.life; // 0=fresh, 1=expired
        ctx.globalAlpha = 1 - t * t;
        const px = Math.round(p.x / cell) * cell;
        const py = Math.round(p.y / cell) * cell;
        drawBlock(ctx, px, py, cell, p.color, Math.max(0, 0.8 - t * 4));
      }
      ctx.restore();
    }

    if (this.powerUp) this.drawPowerUpDrop(ctx, portrait);

    // Draw Pushers, scaled in with an overshoot and a shockwave ring while
    // they pop in at the start of the game
    this.pushers.forEach((pusher, i) => {
      if (this.pusherAppear === null) {
        this.drawPusher(ctx, pusher, portrait);
        return;
      }
      const p = Math.min(1, (this.pusherAppear - i * Settings.PUSHER_APPEAR_STAGGER) / Settings.PUSHER_APPEAR_DURATION);
      if (p <= 0) return;
      const color = this.getColor(pusher.team);
      ctx.save();
      ctx.beginPath();
      ctx.arc(pusher.x, pusher.y, pusher.radius * (1 + p * 1.5), 0, Math.PI * 2);
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();

      // easeOutBack: overshoots slightly past full size, then settles
      const s = 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
      ctx.save();
      ctx.translate(pusher.x, pusher.y);
      ctx.scale(s, s);
      ctx.translate(-pusher.x, -pusher.y);
      this.drawPusher(ctx, pusher, portrait);
      ctx.restore();
    });

    // Draw Pucks
    for (const puck of this.pucks) this.drawPuck(ctx, puck, portrait);

    if (portrait) ctx.restore();
  }

  // Draw a puck. In the last moments before it splits it throbs, faster and
  // faster, then pinches into two lobes along the axis its halves will fly
  // apart on.
  drawPuck(ctx, puck, portrait) {
    const puckColor = this.getColor(puck.lastHitTeam || puck.team);
    const moving = puck.vx !== 0 || puck.vy !== 0;
    const fill = moving ? '#ffffff' : puckColor;

    const timeLeft = this.pucks.length < this.maxPucks ? this.splitTimeLeft(puck) : Infinity;
    if (timeLeft >= Settings.SPLIT_WARNING_TIME) {
      this.drawPixelDisc(ctx, puck.x, puck.y, puck.radius, fill, puckColor, portrait);
      return;
    }

    const warn = 1 - timeLeft / Settings.SPLIT_WARNING_TIME; // 0 → 1
    const throb = 1 + (0.08 + 0.1 * warn) * Math.sin(puck.throbPhase || 0);
    const p = Math.max(0, 1 - timeLeft / Settings.SPLIT_PINCH_TIME);
    const pinch = p * p * (3 - 2 * p); // smoothstep
    const r = puck.radius * throb * (1 - 0.2 * pinch);
    const offset = puck.radius * 0.45 * pinch;
    const axis = this.splitAxis(puck);
    const dx = Math.cos(axis) * offset;
    const dy = Math.sin(axis) * offset;

    if (offset < 0.5) {
      this.drawPixelDisc(ctx, puck.x, puck.y, r, fill, puckColor, portrait);
    } else {
      this.drawPixelDisc(ctx, puck.x + dx, puck.y + dy, r, fill, puckColor, portrait);
      this.drawPixelDisc(ctx, puck.x - dx, puck.y - dy, r, fill, puckColor, portrait);
    }
  }

  // Seconds until this puck splits
  splitTimeLeft(puck) {
    return this.splitInterval - (puck.timeSinceLastSplit || 0);
  }

  // Direction the two halves separate along: across the puck's travel, or a
  // fixed random direction while it sits still
  splitAxis(puck) {
    if (puck.vx || puck.vy) return Math.atan2(puck.vy, puck.vx) + Math.PI / 2;
    if (puck.restAxis === undefined) puck.restAxis = Math.random() * Math.PI;
    return puck.restAxis;
  }

  // Burst of pixels in the puck's color as it pops into two
  spawnSplitPixels(puck) {
    const color = this.getColor(puck.lastHitTeam || puck.team);
    const scale = Math.min(this.width, this.height);
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = scale * (0.15 + Math.random() * 0.35);
      this.goalPixels.push({
        x: puck.x, y: puck.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.3 + Math.random() * 0.3,
        color: Math.random() < 0.4 ? '#ffffff' : color,
      });
    }
  }

  // Draw the drop (gold bolt = speed, green arrow = cross) as a pixel sprite
  // whose blocks fall in from the top of the screen, bottom row first, then
  // flash as they land. Once down it sits on a pulsing halo and sends out
  // beacon rings, and blinks in its last 2 seconds.
  drawPowerUpDrop(ctx, portrait) {
    const { x, y, radius } = this.getPowerUpGeometry();
    const { type, timeLeft } = this.powerUp;
    const now = performance.now() / 1000;
    if (timeLeft < 2 && Math.floor(now * 6) % 2 === 0) return;

    const color = POWERUP_COLORS[type];
    const age = Settings.POWERUP_LIFETIME - timeLeft;
    const landedFor = age - powerUpDropTime(type);
    const cell = Math.max(3, Math.round((2.4 * radius) / POWERUP_SPRITE_SPAN));
    // The cross arrow points across the center line, which runs up the screen
    // in portrait, so turn the sprite on its side there
    const sprite = POWERUP_SPRITES[type];
    const turned = portrait && type === 'cross';
    const rows = turned ? sprite[0].length : sprite.length;
    const cols = turned ? sprite.length : sprite[0].length;
    const lit = (r, c) => (turned ? sprite[c][r] : sprite[r][c]) === '#';
    // Distance from the drop's centre up to the top of the screen
    const screenTop = portrait ? this.width - x : y;
    const left = Math.round((-cols * cell) / 2);
    const top = Math.round((-rows * cell) / 2);

    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (portrait) ctx.rotate(Math.PI / 2); // screen-aligned so blocks fall down the screen

    if (landedFor > 0) {
      // Soft halo behind the sprite, breathing in and out
      const glow = 0.35 + 0.15 * Math.sin(now * 5);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.8);
      halo.addColorStop(0, color);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = glow;
      ctx.fillStyle = halo;
      ctx.fillRect(-radius * 1.8, -radius * 1.8, radius * 3.6, radius * 3.6);
      ctx.globalAlpha = 1;

      // Beacon ring of blocks; the first one, on landing, is the brightest
      const ringT = (landedFor % POWERUP_RING_EVERY) / POWERUP_RING_TIME;
      if (ringT < 1) {
        const strength = landedFor < POWERUP_RING_EVERY ? 1 : 0.5;
        this.drawPixelRing(ctx, radius * (1 + 1.6 * ringT), cell, color, strength * (1 - ringT));
      }
    }

    for (let r = 0; r < rows; r++) {
      const t = age - (rows - 1 - r) * POWERUP_ROW_STAGGER;
      if (t < 0) continue;
      const p = Math.min(1, t / POWERUP_FALL_TIME);
      const targetY = top + r * cell;
      const startY = -screenTop - cell;
      const by = Math.round(startY + (targetY - startY) * p * p); // accelerate like gravity
      const flash = p < 1 ? 0 : Math.max(0, 1 - (t - POWERUP_FALL_TIME) / POWERUP_LAND_FLASH) * 0.8;
      for (let c = 0; c < cols; c++) {
        if (lit(r, c)) drawBlock(ctx, left + c * cell, by, cell, color, flash);
      }
    }
    ctx.restore();
  }

  // A ring of blocks of the given radius around the origin, snapped to a grid
  // of `cell` pixels
  drawPixelRing(ctx, ringRadius, cell, color, alpha) {
    if (alpha <= 0) return;
    const seen = new Set();
    const steps = Math.ceil((2 * Math.PI * ringRadius) / cell);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const gx = Math.round((Math.cos(a) * ringRadius) / cell);
      const gy = Math.round((Math.sin(a) * ringRadius) / cell);
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drawBlock(ctx, gx * cell - cell / 2, gy * cell - cell / 2, cell, color, 0);
    }
    ctx.globalAlpha = 1;
  }

  // Draw a power-up icon on a pusher: a dim full icon with a bright portion
  // showing the fraction of time left (bolt drains top-down, arrow right-to-left).
  drawDrainingIcon(ctx, type, x, y, size, fractionLeft, portrait) {
    ctx.save();
    ctx.translate(x, y);
    if (portrait && type === 'speed') ctx.rotate(Math.PI / 2);
    this.tracePowerUpIcon(ctx, type, size);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    const level = 2 * size * fractionLeft;
    if (type === 'speed') ctx.fillRect(-size, size - level, 2 * size, level);
    else ctx.fillRect(-size, -size, level, 2 * size);
    ctx.restore();
  }

  tracePowerUpIcon(ctx, type, size) {
    if (type === 'cross') this.traceCrossArrow(ctx, size);
    else this.drawBolt(ctx, size);
  }

  // Trace a horizontal double-headed arrow centered on the origin, `size` long
  // in each direction. Caller sets the fill and calls fill().
  traceCrossArrow(ctx, size) {
    const s = size;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(-0.45 * s, -0.55 * s);
    ctx.lineTo(-0.45 * s, -0.2 * s);
    ctx.lineTo(0.45 * s, -0.2 * s);
    ctx.lineTo(0.45 * s, -0.55 * s);
    ctx.lineTo(s, 0);
    ctx.lineTo(0.45 * s, 0.55 * s);
    ctx.lineTo(0.45 * s, 0.2 * s);
    ctx.lineTo(-0.45 * s, 0.2 * s);
    ctx.lineTo(-0.45 * s, 0.55 * s);
    ctx.closePath();
  }

  // Trace a lightning bolt path centered on the origin, roughly `size` tall
  // in each direction. Caller sets the fill and calls fill().
  drawBolt(ctx, size) {
    const s = size;
    ctx.beginPath();
    ctx.moveTo(0.25 * s, -s);
    ctx.lineTo(-0.55 * s, 0.15 * s);
    ctx.lineTo(-0.05 * s, 0.15 * s);
    ctx.lineTo(-0.25 * s, s);
    ctx.lineTo(0.55 * s, -0.15 * s);
    ctx.lineTo(0.05 * s, -0.15 * s);
    ctx.closePath();
  }

  splitPuck(puck) {
    // Replace a puck with two slightly smaller pucks with diverging velocities
    if (!puck) return;
    // If puck no longer exists in array, ignore
    const idx = this.pucks.indexOf(puck);
    if (idx === -1) return;

    // New radius slightly smaller
    const newRadius = Math.max(4, puck.radius * 0.85);

    // Remove the original puck
    this.pucks.splice(idx, 1);

    // Create two new pucks with small diverging velocities
    const angleBase = this.splitAxis(puck) - Math.PI / 2;
    const spread = Math.PI / 6; // 30 degrees
    const speed = (Math.hypot(puck.vx || 0, puck.vy || 0) || (this.baseSpeed * 0.5 * this.speedMultiplier));

    const p1Angle = angleBase + spread;
    const p2Angle = angleBase - spread;

    const vx1 = Math.cos(p1Angle) * speed;
    const vy1 = Math.sin(p1Angle) * speed;
    const vx2 = Math.cos(p2Angle) * speed;
    const vy2 = Math.sin(p2Angle) * speed;

    const createP = (xOffset, yOffset, vx, vy) => ({
      x: puck.x + xOffset,
      y: puck.y + yOffset,
      vx, vy,
      radius: newRadius,
      mass: 1,
      team: puck.team,
      lastHitTeam: puck.lastHitTeam,
      timeSinceLastSplit: 0,
      speedBoost: 0,
    });

    // Place the halves where the pinched lobes were drawn; the +spread half
    // goes on the +axis side so each keeps moving away from the other
    const axis = this.splitAxis(puck);
    const ox = Math.cos(axis) * puck.radius * 0.45;
    const oy = Math.sin(axis) * puck.radius * 0.45;
    const pA = createP(ox, oy, vx1, vy1);
    const pB = createP(-ox, -oy, vx2, vy2);
    this.spawnSplitPixels(puck);

    // Respect maxPucks: if adding two exceeds limit, add only one
    if (this.pucks.length + 2 <= this.maxPucks) {
      this.pucks.push(pA, pB);
    } else if (this.pucks.length + 1 <= this.maxPucks) {
      this.pucks.push(pA);
    }
  }
}
