import { resolveCircleCollision, constrainPusher } from './Physics.js';

export class Game {
  constructor(width, height, numPlayers, inputManager, onGameOver) {
    this.width = width;
    this.height = height;
    this.numPlayers = numPlayers;
    this.inputManager = inputManager;
    this.onGameOver = onGameOver;

    this.score = { team1: 0, team2: 0, team3: 0 };
    this.winningScore = 20;

    // Difficulty scaling
    this.baseSpeed = 300; // pixels per second
    this.speedMultiplier = 1.0;
    this.pusherRadius = Math.min(width, height) * 0.08;
    this.goalSize = Math.min(width, height) * 0.2;
    this.puckRadius = Math.min(width, height) * 0.04;
    this.timeSinceLastPuckSpawn = 0;
    this.timeSinceLastSplit = 0;
    this.splitInterval = 30.0;
    this.possessionThreshold = 5.0;

    this.pucks = [];
    this.pushers = [];
    this.maxPucks = 5; // limit for simultaneous pucks
    
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
      possessionOwner: team || null,
      wasOnOwnerSide: null,
      hasEnteredOwnerSide: false
    });
  }

  onGoalScored(goalTeam, lastHitTeam) {
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
    this.speedMultiplier += 0.05;
    
    // Shrink puck radius by 3% on each goal (minimum 1% of screen)
    const minPuckRadius = Math.min(this.width, this.height) * 0.01;
    this.puckRadius = Math.max(minPuckRadius, this.puckRadius * 0.97);
    this.pucks.forEach(p => p.radius = this.puckRadius);
    
    this.pusherRadius = Math.max(this.puckRadius * 1.2, this.pusherRadius * 0.95);
    this.pushers.forEach(p => p.radius = this.pusherRadius);
    this.goalSize = Math.min(this.width * 0.4, this.goalSize * 1.1);

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
      possessionOwner: null,
      wasOnOwnerSide: null,
      hasEnteredOwnerSide: false
    });
  }

  update(dt) {
    this.timeSinceLastPuckSpawn += dt;
    if (this.timeSinceLastPuckSpawn >= 60) {
      this.timeSinceLastPuckSpawn = 0;
      this.spawnRandomPuckAwayFromGoal();
    }

    // 1. Update pushers from input
    for (const pusher of this.pushers) {
      if (pusher.isAI) {
        let targetX = this.width - this.goalSize; // Stay near right goal defensively
        let targetY = this.height / 2;

        let closestIncomingPuck = null;
        let minDist = Infinity;
        for (const puck of this.pucks) {
          if (puck.vx > 0) { // moving towards AI side
            const dist = Math.hypot(puck.x - pusher.x, puck.y - pusher.y);
            if (dist < minDist) {
              minDist = dist;
              closestIncomingPuck = puck;
            }
          }
        }

        if (closestIncomingPuck) {
          targetY = closestIncomingPuck.y;
          targetX = this.width - this.goalSize - pusher.radius;
          if (closestIncomingPuck.x > this.width / 2) {
            targetX = Math.min(closestIncomingPuck.x + closestIncomingPuck.radius + pusher.radius, this.width - pusher.radius);
          }
        } else {
           // If no moving pucks, check for stationary pucks nearby to clear them
           let closestStationary = null;
           let minStatDist = Infinity;
           for (const puck of this.pucks) {
             const speed = Math.hypot(puck.vx, puck.vy);
             if (speed === 0 && puck.x > this.width / 2) {
               const dist = Math.hypot(puck.x - pusher.x, puck.y - pusher.y);
               if (dist < minStatDist) {
                 minStatDist = dist;
                 closestStationary = puck;
               }
             }
           }
           if (closestStationary && minStatDist < this.width * 0.3) {
             targetX = closestStationary.x;
             targetY = closestStationary.y;
           }
        }

        const dx = targetX - pusher.x;
        const dy = targetY - pusher.y;
        const distToTarget = Math.hypot(dx, dy);
        const aiSpeed = this.baseSpeed * 1.5 * this.speedMultiplier;

        if (distToTarget > 0) {
          const moveDist = Math.min(aiSpeed * dt, distToTarget);
          pusher.vx = (dx / distToTarget) * aiSpeed;
          pusher.vy = (dy / distToTarget) * aiSpeed;
          pusher.x += (dx / distToTarget) * moveDist;
          pusher.y += (dy / distToTarget) * moveDist;
        } else {
          pusher.vx = 0;
          pusher.vy = 0;
        }
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
        puck.vx = (puck.vx / speed) * targetSpeed;
        puck.vy = (puck.vy / speed) * targetSpeed;
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;
      }
    }

    // 2b. Periodic splitting: every 30s, attempt to split existing pucks
    this.timeSinceLastSplit += dt;
    if (this.timeSinceLastSplit >= this.splitInterval) {
      this.timeSinceLastSplit = 0;
      // iterate over a copy because we'll modify the array
      const currentPucks = Array.from(this.pucks);
      for (const puck of currentPucks) {
        if (this.pucks.length >= this.maxPucks) break;
        this.splitPuck(puck);
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
          if (puck.y > cy - this.goalSize/2 && puck.y < cy + this.goalSize/2) {
            hitGoalTeam = 1;
          } else {
            puck.x = puck.radius;
            puck.vx *= -1;
          }
        }
        // Right Wall
        if (puck.x + puck.radius > this.width) {
          if (puck.y > cy - this.goalSize/2 && puck.y < cy + this.goalSize/2) {
            hitGoalTeam = 2;
          } else {
            puck.x = this.width - puck.radius;
            puck.vx *= -1;
          }
        }
        // Top Wall
        if (puck.y - puck.radius < 0) {
          if (puck.x > cx - this.goalSize/2 && puck.x < cx + this.goalSize/2) {
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
        // Left Wall
        if (puck.x - puck.radius < 0) {
          if (puck.y < this.goalSize || puck.y > this.height - this.goalSize) {
            hitGoalTeam = 1;
          } else {
            puck.x = puck.radius;
            puck.vx *= -1;
          }
        }
        // Right Wall
        if (puck.x + puck.radius > this.width) {
          if (puck.y < this.goalSize || puck.y > this.height - this.goalSize) {
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
        this.onGoalScored(hitGoalTeam, lastHit);
      }
    }

    // Puck vs Pusher
    for (const puck of this.pucks) {
      for (const pusher of this.pushers) {
        const oldVx = puck.vx;
        const oldVy = puck.vy;
        resolveCircleCollision(pusher, puck, 1.0);
        if (puck.vx !== oldVx || puck.vy !== oldVy) {
          // Collision happened!
          puck.lastHitTeam = pusher.team;
          // Do not reset possession timer or owner here — ownership/timer logic is handled in the possession-check
        }
        // Add small repulsion to avoid puck sticking to pusher
        const dx = puck.x - pusher.x;
        const dy = puck.y - pusher.y;
        const dist = Math.hypot(dx, dy);
        const minDist = (pusher.radius || 0) + (puck.radius || 0);
        if (dist > 0 && dist < minDist + 1) {
          const nx = dx / dist;
          const ny = dy / dist;
          const penetration = Math.max(0, minDist - dist);
          const repulseBase = this.baseSpeed * 0.25; // tuned small push
          const repulse = repulseBase * Math.min(1, penetration / (puck.radius + 1));

          // Apply instantaneous velocity away from pusher
          puck.vx += nx * repulse;
          puck.vy += ny * repulse;

          // Small positional nudge to ensure separation
          const nudge = penetration + 0.5;
          puck.x += nx * nudge;
          puck.y += ny * nudge;
        }
      }
    }

    // Possession check: if a puck remains on a player's side for too long, split that puck
    for (const puck of this.pucks) {
      if (!('possessionTimer' in puck)) {
        puck.possessionTimer = 0;
        puck.possessionOwner = puck.lastHitTeam || null;
        puck.wasOnOwnerSide = null;
        puck.hasEnteredOwnerSide = false;
      }

      if (puck.lastHitTeam) {
        // Determine whether the puck is currently on the side of `lastHitTeam` (candidate owner)
        const candidate = puck.lastHitTeam;
        let candidateOnSide = false;
        if (this.numPlayers === 3) {
          const cx = this.width / 2;
          const cy = this.height / 2;
          if (candidate === 1) candidateOnSide = puck.x < cx;
          else if (candidate === 2) candidateOnSide = puck.x > cx;
          else if (candidate === 3) candidateOnSide = puck.y < cy;
        } else {
          if (candidate === 1) candidateOnSide = puck.x < this.width / 2;
          else if (candidate === 2) candidateOnSide = puck.x >= this.width / 2;
          else candidateOnSide = puck.y < this.height / 2;
        }

        // If ownership changed, only reset the timer when it's the initial assignment
        // or when the puck had previously been off the owner's side and has now returned.
        if (puck.possessionOwner !== puck.lastHitTeam) {
          if (puck.possessionOwner == null) {
            puck.possessionOwner = puck.lastHitTeam;
            puck.possessionTimer = 0;
            puck.hasEnteredOwnerSide = false; // timer doesn't start until it enters territory
          } else if (puck.wasOnOwnerSide === false && candidateOnSide) {
            // puck crossed back into the owner's side
            puck.possessionOwner = puck.lastHitTeam;
            puck.possessionTimer = 0;
            puck.hasEnteredOwnerSide = false; // restart waiting for entry
          } else {
            // change owner without resetting the timer
            puck.possessionOwner = puck.lastHitTeam;
          }
        }

        const owner = puck.possessionOwner;
        let onSide = false;
        if (this.numPlayers === 3) {
          const cx = this.width / 2;
          const cy = this.height / 2;
          if (owner === 1) onSide = puck.x < cx;
          else if (owner === 2) onSide = puck.x > cx;
          else if (owner === 3) onSide = puck.y < cy;
        } else {
          if (owner === 1) onSide = puck.x < this.width / 2;
          else if (owner === 2) onSide = puck.x >= this.width / 2;
          else onSide = puck.y < this.height / 2;
        }

        // If puck enters owner's side, mark that it has entered
        if (onSide && !puck.hasEnteredOwnerSide) {
          puck.hasEnteredOwnerSide = true;
        }

        // Only increment timer if puck has entered the owner's side and is still there
        if (puck.hasEnteredOwnerSide && onSide) {
          puck.possessionTimer += dt;
        } else if (!onSide) {
          // decay timer slowly if they move away (but keep hasEnteredOwnerSide true for resumption)
          puck.possessionTimer = Math.max(0, puck.possessionTimer - dt * 2);
        }

        // remember side state for next frame
        puck.wasOnOwnerSide = onSide;

        const threshold = this.possessionThreshold || 5.0; // seconds
        if (puck.possessionTimer >= threshold) {
          // split this trapped puck (if space allowed)
          if (this.pucks.length < this.maxPucks) {
            this.splitPuck(puck);
          }

          // reset timer/owner to avoid immediate repeat
          puck.possessionTimer = 0;
          puck.possessionOwner = null;
          puck.wasOnOwnerSide = null;
          puck.hasEnteredOwnerSide = false;
        }
      } else {
        // no recent hitter; decay any timer
        puck.possessionTimer = Math.max(0, (puck.possessionTimer || 0) - dt);
        puck.wasOnOwnerSide = null;
        puck.hasEnteredOwnerSide = false;
      }
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
    const gSize = this.goalSize;

    if (this.numPlayers === 3) {
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

      // Draw Goals
      ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'; // Team 1 Goal (Left Middle)
      ctx.fillRect(0, cy - gSize/2, 10, gSize);

      ctx.fillStyle = 'rgba(255, 0, 255, 0.3)'; // Team 2 Goal (Right Middle)
      ctx.fillRect(this.width - 10, cy - gSize/2, 10, gSize);

      ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Team 3 Goal (Top Middle)
      ctx.fillRect(cx - gSize/2, 0, gSize, 10);
    } else {
      // Draw Center Line
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, this.height);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Draw Goals
      ctx.fillStyle = 'rgba(0, 255, 255, 0.2)'; // Team 1 goals
      ctx.fillRect(0, 0, 10, gSize);
      ctx.fillRect(0, this.height - gSize, 10, gSize);

      ctx.fillStyle = 'rgba(255, 0, 255, 0.2)'; // Team 2 goals
      ctx.fillRect(this.width - 10, 0, 10, gSize);
      ctx.fillRect(this.width - 10, this.height - gSize, 10, gSize);
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
      // Outer arc: global split progress
      const globalProgress = Math.min(1, (this.timeSinceLastSplit || 0) / (this.splitInterval || 30));
      if (globalProgress > 0) {
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(100,150,255,0.9)';
        const start = -Math.PI / 2;
        const end = start + globalProgress * Math.PI * 2;
        ctx.arc(puck.x, puck.y, puck.radius + 8, start, end);
        ctx.stroke();
      }

      // Inner arc: possession-based split progress (if applicable)
      let possessionProgress = 0;
      if (puck.possessionOwner) {
        // determine if puck is still on the owner's side
        const owner = puck.possessionOwner;
        let onSide = false;
        if (this.numPlayers === 3) {
          const cx = this.width / 2;
          const cy = this.height / 2;
          if (owner === 1) onSide = puck.x < cx;
          else if (owner === 2) onSide = puck.x > cx;
          else if (owner === 3) onSide = puck.y < cy;
        } else {
          if (owner === 1) onSide = puck.x < this.width / 2;
          else if (owner === 2) onSide = puck.x >= this.width / 2;
          else onSide = puck.y < this.height / 2;
        }

        if (onSide) {
          possessionProgress = Math.min(1, (puck.possessionTimer || 0) / (this.possessionThreshold || 5));
        }
      }

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
    const angleBase = Math.random() * Math.PI * 2;
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
      possessionOwner: puck.possessionOwner || puck.lastHitTeam || null,
      wasOnOwnerSide: null,
      hasEnteredOwnerSide: false
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
