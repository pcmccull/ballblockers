import { resolveCircleCollision, constrainPusher } from './Physics.js';
import * as Settings from './settings.js';
import { AIController, AI_DIFFICULTY } from './AiPlayer.js';

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
    this.puckRadius = Math.min(width, height) * Settings.PUCK_RADIUS_FRACTION;
    this.splitInterval = Settings.SPLIT_INTERVAL;
    this.possessionThreshold = Settings.POSSESSION_THRESHOLD;

    this.pucks = [];
    this.pushers = [];
    this.maxPucks = Settings.MAX_PUCKS;

    this.goalFlashTimer = 0;
    this.goalFlashDuration = 0.6;
    this.lastScoredGoalTeam = null;
    this.lastScoredGoalX = 0;
    this.lastScoredGoalY = 0;
    this.lastScoredByTeam = null;
    this.lastScoredPuckRadius = 0;

    this.aiController = new AIController(AI_DIFFICULTY[difficulty] ?? AI_DIFFICULTY.hard);

    this.initPlayers();

    // Start with one initial puck in the center moving randomly
    this.spawnPuck(width / 2, height / 2, true);
  }

  onResize(width, height) {
    this.width = width;
    this.height = height;
    // Scale existing elements roughly
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
    return { x, y, vx: 0, vy: 0, radius: this.pusherRadius, team, quadrants, mass: Infinity, isAI };
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
      possessionTimer: 0,
      timeSinceLastSplit: 0,
      lastX: spawnX,
      lastY: spawnY
    });
  }

  onGoalScored(goalTeam, lastHitTeam, puckX, puckY) {
    // Start the goal flash effect with the scoring player's color at the exact goal position
    this.goalFlashTimer = this.goalFlashDuration;
    this.lastScoredGoalTeam = goalTeam;
    this.lastScoredByTeam = lastHitTeam;
    this.lastScoredGoalX = puckX;
    this.lastScoredGoalY = puckY;
    this.lastScoredPuckRadius = this.puckRadius; // captured before radius shrinks

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
    this.pucks.forEach(p => p.radius = this.puckRadius);

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

  constrainPusherRadial(pusher) {
    const cx = this.width / 2;
    const cy = this.height / 2;
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
      goals.push({ x: 0, y: cy });
      goals.push({ x: this.width, y: cy });
      goals.push({ x: cx, y: 0 });
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
      possessionTimer: 0,
      timeSinceLastSplit: 0,
      lastX: x,
      lastY: y
    });
  }

  update(dt) {
    // Update goal flash timer
    if (this.goalFlashTimer > 0) {
      this.goalFlashTimer -= dt;
    }

    // 1. Update pushers from input
    for (const pusher of this.pushers) {
      if (pusher.isAI) {
        this.aiController.update(pusher, this.pucks, {
          width: this.width,
          height: this.height,
          goalSizes: this.goalSizes,
          baseSpeed: this.baseSpeed,
          speedMultiplier: this.speedMultiplier,
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

          // Cap velocity so it doesn't fly off
          const maxSpeed = this.baseSpeed * 8 * this.speedMultiplier;
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

      if (this.numPlayers === 3) {
        this.constrainPusherRadial(pusher);
      } else {
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
    }

    // 2. Move Pucks
    for (const puck of this.pucks) {
      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed > 0) {
        const targetSpeed = this.baseSpeed * this.speedMultiplier;
        let newSpeed = speed;
        
        // Allow the puck to exceed targetSpeed when hit, then decay it via friction
        if (speed > targetSpeed) {
          // Slow down by a factor of the target speed to return to baseline
          newSpeed -= targetSpeed * Settings.PUCK_FRICTION * dt;
          if (newSpeed < targetSpeed) newSpeed = targetSpeed;
        } else if (speed < targetSpeed) {
          // Immediately recover to minimum target speed
          newSpeed = targetSpeed;
        }
        
        // Cap the maximum possible speed to prevent skipping through walls
        const maxPuckSpeed = targetSpeed * Settings.MAX_IMPACT_SPEED_MULTIPLIER;
        if (newSpeed > maxPuckSpeed) newSpeed = maxPuckSpeed;

        puck.vx = (puck.vx / speed) * newSpeed;
        puck.vy = (puck.vy / speed) * newSpeed;
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;
      }
    }

    // 2b. Periodic splitting: every 30s per puck, attempt to split existing pucks
    const currentPucks = Array.from(this.pucks);
    for (const puck of currentPucks) {
      puck.timeSinceLastSplit = (puck.timeSinceLastSplit || 0) + dt;
      if (puck.timeSinceLastSplit >= this.splitInterval) {
        puck.timeSinceLastSplit = 0;
        if (this.pucks.length < this.maxPucks) {
          this.splitPuck(puck);
        }
      }
    }

    // 3. Collisions
    for (let i = this.pucks.length - 1; i >= 0; i--) {
      const puck = this.pucks[i];

      let hitGoalTeam = 0;

      if (this.numPlayers === 3) {
        const cx = this.width / 2;
        const cy = this.height / 2;

        // Left Wall
        if (puck.x - puck.radius < 0) {
          const g1 = this.goalSizes.team1;
          if (puck.y > cy - g1 / 2 && puck.y < cy + g1 / 2) {
            hitGoalTeam = 1;
          } else {
            puck.x = puck.radius;
            puck.vx *= -1;
          }
        }
        // Right Wall
        if (puck.x + puck.radius > this.width) {
          const g2 = this.goalSizes.team2;
          if (puck.y > cy - g2 / 2 && puck.y < cy + g2 / 2) {
            hitGoalTeam = 2;
          } else {
            puck.x = this.width - puck.radius;
            puck.vx *= -1;
          }
        }
        // Top Wall
        if (puck.y - puck.radius < 0) {
          const g3 = this.goalSizes.team3;
          if (puck.x > cx - g3 / 2 && puck.x < cx + g3 / 2) {
            hitGoalTeam = 3;
          } else {
            puck.y = puck.radius;
            puck.vy *= -1;
          }
        }
        // Bottom Wall (Solid in 3-player)
        if (puck.y + puck.radius > this.height) {
          puck.y = this.height - puck.radius;
          puck.vy *= -1;
        }
      } else {
        const g1 = this.goalSizes.team1;
        const g2 = this.goalSizes.team2;
        // Left Wall
        if (puck.x - puck.radius < 0) {
          if (puck.y < g1 || puck.y > this.height - g1) {
            hitGoalTeam = 1;
          } else {
            puck.x = puck.radius;
            puck.vx *= -1;
          }
        }
        // Right Wall
        if (puck.x + puck.radius > this.width) {
          if (puck.y < g2 || puck.y > this.height - g2) {
            hitGoalTeam = 2;
          } else {
            puck.x = this.width - puck.radius;
            puck.vx *= -1;
          }
        }
        // Top/Bottom Walls
        if (puck.y - puck.radius < 0) {
          puck.y = puck.radius;
          puck.vy *= -1;
        }
        if (puck.y + puck.radius > this.height) {
          puck.y = this.height - puck.radius;
          puck.vy *= -1;
        }
      }

      if (hitGoalTeam !== 0) {
        const lastHit = puck.lastHitTeam;
        this.pucks.splice(i, 1);
        this.onGoalScored(hitGoalTeam, lastHit, puck.x, puck.y);
      }
    }

    // Puck vs Pusher
    for (const puck of this.pucks) {
      for (const pusher of this.pushers) {
        const preDx = puck.x - pusher.x;
        const preDy = puck.y - pusher.y;
        const preDist = Math.hypot(preDx, preDy);
        const minDist = (pusher.radius || 0) + (puck.radius || 0);
        const prePenetration = Math.max(0, minDist - preDist);

        const oldVx = puck.vx;
        const oldVy = puck.vy;
        resolveCircleCollision(pusher, puck, 1.0);
        if (puck.vx !== oldVx || puck.vy !== oldVy) {
          // Collision happened!
          puck.lastHitTeam = pusher.team;
          // Do not reset possession timer or owner here — ownership/timer logic is handled in the possession-check
        }

        const postDx = puck.x - pusher.x;
        const postDy = puck.y - pusher.y;
        const postDist = Math.hypot(postDx, postDy);

        if (postDist > 0 && (postDist < minDist + 1 || prePenetration > 0)) {
          const nx = postDx / postDist;
          const ny = postDy / postDist;
          const effectivePenetration = Math.max(prePenetration, minDist - postDist);

          // Use pre-collision relative approach speed along normal for consistent hit strength.
          // oldVx/oldVy is the puck's velocity before resolveCircleCollision modified it.
          const relApproach = Math.max(0, (pusher.vx - oldVx) * nx + (pusher.vy - oldVy) * ny);
          const speedFactor = Math.min(1, relApproach / this.baseSpeed);

          const repulse = this.baseSpeed * Settings.IMPACT_REPULSION_MULTIPLIER * speedFactor;

          // Apply instantaneous velocity away from pusher
          puck.vx += nx * repulse;
          puck.vy += ny * repulse;

          // Add swipe friction from the pusher so grazing hits shoot the puck forward
          const tx = -ny;
          const ty = nx;
          const tangentDiff = (pusher.vx * tx + pusher.vy * ty) - (oldVx * tx + oldVy * ty);
          puck.vx += tx * tangentDiff * 0.4 * speedFactor;
          puck.vy += ty * tangentDiff * 0.4 * speedFactor;

          // Small positional nudge to ensure separation
          const nudge = effectivePenetration > 0 ? 0.5 : 0;
          puck.x += nx * nudge;
          puck.y += ny * nudge;
        }
      }
    }

    // Possession check: timer increments whenever puck crosses a boundary
    for (const puck of this.pucks) {
      if (!('possessionTimer' in puck)) {
        puck.possessionTimer = 0;
        puck.lastX = puck.x;
        puck.lastY = puck.y;
      }

      // Check if puck crossed a boundary
      let crossedBoundary = false;
      if (this.numPlayers === 3) {
        const cx = this.width / 2;
        const cy = this.height / 2;
        // Crossed vertical line (x = cx)
        if ((puck.lastX < cx && puck.x >= cx) || (puck.lastX >= cx && puck.x < cx)) {
          crossedBoundary = true;
        }
        // Crossed horizontal line (y = cy)
        if ((puck.lastY < cy && puck.y >= cy) || (puck.lastY >= cy && puck.y < cy)) {
          crossedBoundary = true;
        }
      } else {
        const midX = this.width / 2;
        // Crossed vertical centerline
        if ((puck.lastX < midX && puck.x >= midX) || (puck.lastX >= midX && puck.x < midX)) {
          crossedBoundary = true;
        }
        if (this.numPlayers === 4) {
          const midY = this.height / 2;
          // Crossed horizontal centerline
          if ((puck.lastY < midY && puck.y >= midY) || (puck.lastY >= midY && puck.y < midY)) {
            crossedBoundary = true;
          }
        }
      }

      // Reset timer whenever boundary is crossed
      if (crossedBoundary) {
        puck.possessionTimer = 0;
      } else {
        // Increment timer every frame puck stays in same region
        puck.possessionTimer += dt;
      }

      const threshold = this.possessionThreshold;
      if (puck.possessionTimer >= threshold) {
        // split this puck (if space allowed)
        if (this.pucks.length < this.maxPucks) {
          this.splitPuck(puck);
        }
        // reset timer to avoid immediate repeat
        puck.possessionTimer = 0;
      }

      // Remember current position for next frame's boundary check
      puck.lastX = puck.x;
      puck.lastY = puck.y;
    }

    // Puck vs Puck
    for (let i = 0; i < this.pucks.length; i++) {
      for (let j = i + 1; j < this.pucks.length; j++) {
        const p1 = this.pucks[i];
        const p2 = this.pucks[j];
        const oldV1x = p1.vx;
        resolveCircleCollision(p1, p2, 1.0);
        if (p1.vx !== oldV1x) {
          // Transfer ownership? Or just keep their own ownership
          const temp = p1.lastHitTeam;
          p1.lastHitTeam = p2.lastHitTeam || p1.lastHitTeam;
          p2.lastHitTeam = temp || p2.lastHitTeam;
        }
      }
    }
  }

  getColor(team) {
    if (team === 1) return '#00ffff';
    if (team === 2) return '#ff00ff';
    if (team === 3) return '#ffff00';
    return '#ffffff';
  }

  draw(ctx) {
    ctx.clearRect(0, 0, this.width, this.height);

    const cx = this.width / 2;
    const cy = this.height / 2;

    if (this.numPlayers === 3) {
      const g1 = this.goalSizes.team1;
      const g2 = this.goalSizes.team2;
      const g3 = this.goalSizes.team3;

      // Draw radial backgrounds
      // Team 1 (Left)
      ctx.fillStyle = 'rgba(0, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(0, 0);
      ctx.lineTo(0, this.height);
      ctx.lineTo(cx, this.height);
      ctx.fill();

      // Team 2 (Right)
      ctx.fillStyle = 'rgba(255, 0, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(this.width, 0);
      ctx.lineTo(this.width, this.height);
      ctx.lineTo(cx, this.height);
      ctx.fill();

      // Team 3 (Top)
      ctx.fillStyle = 'rgba(255, 255, 0, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(0, 0);
      ctx.lineTo(this.width, 0);
      ctx.fill();

      // Draw radial lines
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, this.height); // Down
      ctx.moveTo(cx, cy);
      ctx.lineTo(0, 0); // Top-left
      ctx.moveTo(cx, cy);
      ctx.lineTo(this.width, 0); // Top-right
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Draw goal semicircles (D-zones in front of each goal)
      ctx.lineWidth = 2;

      ctx.fillStyle = 'rgba(0, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, cy, this.goalDepth, g1 / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 0, 255, 0.12)';
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(this.width, cy, this.goalDepth, g2 / 2, 0, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 0, 0.12)';
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, 0, g3 / 2, this.goalDepth, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw Goals
      ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'; // Team 1 Goal (Left Middle)
      ctx.fillRect(0, cy - g1 / 2, 10, g1);

      ctx.fillStyle = 'rgba(255, 0, 255, 0.3)'; // Team 2 Goal (Right Middle)
      ctx.fillRect(this.width - 10, cy - g2 / 2, 10, g2);

      ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Team 3 Goal (Top Middle)
      ctx.fillRect(cx - g3 / 2, 0, g3, 10);
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

      // Draw center vertical line (team boundary)
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, this.height);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 5;
      ctx.stroke();

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

      // Draw goal semicircles (D-zones in front of each goal)
      const g1 = this.goalSizes.team1;
      const g2 = this.goalSizes.team2;
      ctx.lineWidth = 2;

      ctx.fillStyle = 'rgba(0, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, g1 / 2, this.goalDepth, g1 / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, this.height - g1 / 2, this.goalDepth, g1 / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 0, 255, 0.12)';
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(this.width, g2 / 2, this.goalDepth, g2 / 2, 0, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(this.width, this.height - g2 / 2, this.goalDepth, g2 / 2, 0, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw Goals
      ctx.fillStyle = 'rgba(0, 255, 255, 0.2)'; // Team 1 goals
      ctx.fillRect(0, 0, 10, g1);
      ctx.fillRect(0, this.height - g1, 10, g1);

      ctx.fillStyle = 'rgba(255, 0, 255, 0.2)'; // Team 2 goals
      ctx.fillRect(this.width - 10, 0, 10, g2);
      ctx.fillRect(this.width - 10, this.height - g2, 10, g2);
    }

    // Draw doorway light effect: directional beam from the exact entry point on the wall
    if (this.goalFlashTimer > 0) {
      const t = this.goalFlashTimer / this.goalFlashDuration; // 1=fresh, 0=expired
      const alpha = t * 0.85;

      const ballColor = this.getColor(this.lastScoredByTeam || this.lastScoredGoalTeam);
      const gTeam = this.lastScoredGoalTeam;
      const entryY = this.lastScoredGoalY;
      const entryX = this.lastScoredGoalX;
      const half = this.lastScoredPuckRadius * 1.3;
      const spread = 0.15; // fan rate — how much the beam widens per unit of distance

      const rc = parseInt(ballColor.slice(1, 3), 16);
      const gc = parseInt(ballColor.slice(3, 5), 16);
      const bc = parseInt(ballColor.slice(5, 7), 16);
      const rgba = (a) => `rgba(${rc},${gc},${bc},${a.toFixed(3)})`;

      const L = Math.max(this.width, this.height) * 2; // large enough to cover screen

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath();

      if (gTeam === 1) {
        // Left wall — beam fans RIGHT from x=0
        ctx.moveTo(0, entryY - half);
        ctx.lineTo(L, entryY - half - L * spread);
        ctx.lineTo(L, entryY + half + L * spread);
        ctx.lineTo(0, entryY + half);
      } else if (gTeam === 2) {
        // Right wall — beam fans LEFT from x=width
        ctx.moveTo(this.width, entryY - half);
        ctx.lineTo(this.width - L, entryY - half - L * spread);
        ctx.lineTo(this.width - L, entryY + half + L * spread);
        ctx.lineTo(this.width, entryY + half);
      } else if (gTeam === 3) {
        // Top wall — beam fans DOWN from y=0
        ctx.moveTo(entryX - half, 0);
        ctx.lineTo(entryX - half - L * spread, L);
        ctx.lineTo(entryX + half + L * spread, L);
        ctx.lineTo(entryX + half, 0);
      }

      ctx.closePath();
      ctx.clip();

      const reach = Math.min(this.width, this.height) * 0.25;
      let grad;
      if (gTeam === 1) {
        grad = ctx.createLinearGradient(0, entryY, reach, entryY);
      } else if (gTeam === 2) {
        grad = ctx.createLinearGradient(this.width, entryY, this.width - reach, entryY);
      } else if (gTeam === 3) {
        grad = ctx.createLinearGradient(entryX, 0, entryX, reach);
      }

      if (grad) {
        grad.addColorStop(0, rgba(alpha));
        grad.addColorStop(0.2, rgba(alpha * 0.75));
        grad.addColorStop(0.5, rgba(alpha * 0.35));
        grad.addColorStop(1, rgba(0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.width, this.height);
      }

      ctx.restore();
    }

    // Draw Pushers
    for (const pusher of this.pushers) {
      ctx.beginPath();
      ctx.arc(pusher.x, pusher.y, pusher.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.getColor(pusher.team);
      ctx.shadowBlur = 15;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0; // reset
    }

    // Draw Pucks
    for (const puck of this.pucks) {
      ctx.beginPath();
      ctx.arc(puck.x, puck.y, puck.radius, 0, Math.PI * 2);

      const puckColor = this.getColor(puck.lastHitTeam || puck.team);
      const speed = Math.hypot(puck.vx, puck.vy);

      if (speed === 0) {
        // Stationary puck
        ctx.fillStyle = puckColor;
        ctx.shadowBlur = 20;
        ctx.shadowColor = puckColor;
        ctx.fill();
      } else {
        // Inner white, outer color
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = puckColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = puckColor;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Draw graphical split timers as arcs around the puck (no numbers)
      // Outer arc: puck-specific split progress
      const splitProgress = Math.min(1, (puck.timeSinceLastSplit || 0) / this.splitInterval);
      if (splitProgress > 0) {
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(100,150,255,0.9)';
        const start = -Math.PI / 2;
        const end = start + splitProgress * Math.PI * 2;
        ctx.arc(puck.x, puck.y, puck.radius + 8, start, end);
        ctx.stroke();
      }

      // Inner arc: possession timer progress (time in current region)
      const possessionProgress = Math.min(1, (puck.possessionTimer || 0) / this.possessionThreshold);

      if (possessionProgress > 0) {
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,200,0,0.95)';
        const start = -Math.PI / 2;
        const end = start + possessionProgress * Math.PI * 2;
        ctx.arc(puck.x, puck.y, puck.radius + 4, start, end);
        ctx.stroke();
      }
    }
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
    const angleBase = (puck.vx || puck.vy) ? Math.atan2(puck.vy, puck.vx) : Math.random() * Math.PI * 2;
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
      possessionTimer: 0,
      timeSinceLastSplit: 0,
      lastX: puck.x + xOffset,
      lastY: puck.y + yOffset
    });

    // Slight position jitter so they don't overlap exactly
    const jitter = Math.max(2, newRadius);
    const pA = createP((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, vx1, vy1);
    const pB = createP((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, vx2, vy2);

    // Respect maxPucks: if adding two exceeds limit, add only one
    if (this.pucks.length + 2 <= this.maxPucks) {
      this.pucks.push(pA, pB);
    } else if (this.pucks.length + 1 <= this.maxPucks) {
      this.pucks.push(pA);
    }
  }
}
