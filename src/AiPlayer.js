import * as Settings from './settings.js';

// AI difficulty presets — each rule can be toggled independently
export const AI_DIFFICULTY = {
  easy: {
    sprintFactor: 1.2,         // speed when hurrying, as a multiple of baseSpeed * speedMultiplier;
                               // still limited by the same stamina cap as human pushers
    getsBehindPuck: false,     // reposition behind puck before striking
    aimsShots: false,          // calculate aimed shots toward opponent's goal
    tracksOpponentSide: false, // anticipate by mirroring puck clusters on opponent's side
    chasesOwnSide: true,       // chase pucks already on AI's side
    collectsPowerUps: false,   // leave the goal to grab speed drops when no puck is incoming
    managesStamina: false,     // stand still to refill stamina whenever there's time to spare
  },
  medium: {
    sprintFactor: 2.0,
    getsBehindPuck: true,
    aimsShots: false,
    tracksOpponentSide: true,
    chasesOwnSide: true,
    collectsPowerUps: true,
    managesStamina: false,
  },
  hard: {
    sprintFactor: 2.6,
    getsBehindPuck: true,
    aimsShots: true,
    tracksOpponentSide: true,
    chasesOwnSide: true,
    collectsPowerUps: true,
    managesStamina: true,
  },
};

// How much faster the AI moves while it holds a speed boost
const AI_BOOST_SPEED_FACTOR = 2;

// Speed when repositioning without urgency, as a multiple of baseSpeed * speedMultiplier.
// Slow enough to be cheap, but it still drains stamina like any movement.
const AI_CRUISE_FACTOR = 0.95;

// Stamina management (managesStamina). Stamina only refills while standing still,
// so a rested AI moves late and in bursts instead of constantly drifting.
// REST_SAFETY_FACTOR  — how much longer than the trip itself the AI wants in hand
//                       before it will keep resting while a puck is incoming.
// REST_SAFETY_MARGIN  — extra seconds on top, for bounces and reaction time.
// TIRED_STAMINA       — below this, a puck on its side drifting away from its goal
//                       isn't worth chasing; it rests instead.
const REST_SAFETY_FACTOR = 1.6;
const REST_SAFETY_MARGIN = 0.35;
const TIRED_STAMINA = 0.45;

export class AIController {
  constructor(rules = AI_DIFFICULTY.hard) {
    this.rules = rules;
  }

  update(pusher, pucks, gameState, dt) {
    const { width, height, goalSizes, baseSpeed, speedMultiplier, maxSpeed, powerUp } = gameState;
    const { targetX, targetY, urgent, puck } = this._computeTarget(pusher, pucks, width, height, goalSizes, powerUp);

    // Like a human, the AI sprints only when it has to (a puck to play or a drop
    // to grab) and otherwise repositions at a slow cruising speed. All movement
    // costs stamina, so it only recovers once it settles at its target. Either
    // way it is held to the same stamina-dependent cap as human pushers.
    const unit = baseSpeed * speedMultiplier;
    const boost = pusher.boostTimer > 0 ? AI_BOOST_SPEED_FACTOR : 1;
    const desired = urgent
      ? this.rules.sprintFactor * boost
      : Math.min(this.rules.sprintFactor, AI_CRUISE_FACTOR);
    // Tire like a human: every speed shrinks by the same fraction the human top
    // speed does as stamina runs out, so an exhausted AI is visibly slower even
    // when its chosen speed is already under the stamina cap.
    const fatigue = pusher.boostTimer > 0 ? 1 :
      (Settings.PUSHER_EXHAUSTED_SPEED_FACTOR +
        (Settings.PUSHER_MAX_SPEED_FACTOR - Settings.PUSHER_EXHAUSTED_SPEED_FACTOR) * pusher.stamina) /
      Settings.PUSHER_MAX_SPEED_FACTOR;
    const aiSpeed = Math.min(unit * desired * fatigue, maxSpeed);
    const dx = targetX - pusher.x;
    const dy = targetY - pusher.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 0 && this.rules.managesStamina && this._shouldRest(pusher, puck, urgent, dist, aiSpeed, width)) {
      pusher.vx = 0;
      pusher.vy = 0;
      return;
    }

    if (dist > 0) {
      const moveDist = Math.min(aiSpeed * dt, dist);
      pusher.vx = (dx / dist) * aiSpeed;
      pusher.vy = (dy / dist) * aiSpeed;
      pusher.x += (dx / dist) * moveDist;
      pusher.y += (dy / dist) * moveDist;
    } else {
      pusher.vx = 0;
      pusher.vy = 0;
    }
  }

  // Whether holding still to refill stamina is safe right now
  _shouldRest(pusher, puck, urgent, dist, aiSpeed, width) {
    if (pusher.boostTimer > 0 || pusher.stamina >= 1) return false;

    if (!urgent) {
      // Repositioning without a threat: don't chase small shifts of the target,
      // and tolerate more drift the more tired it is
      return dist < pusher.radius * (1 + 4 * (1 - pusher.stamina));
    }
    if (!puck) return false; // racing for a power-up (it refills stamina anyway)

    if (puck.vx > 0) {
      // Incoming: rest while it can still get there in time by leaving later
      const timeToArrive = (pusher.x - puck.x) / puck.vx;
      const timeNeeded = dist / Math.max(aiSpeed, 1e-6);
      return timeToArrive > timeNeeded * REST_SAFETY_FACTOR + REST_SAFETY_MARGIN;
    }

    // On its side but heading away from its goal: only worth chasing with stamina to spare
    return puck.x > width / 2 && pusher.stamina < TIRED_STAMINA;
  }

  _computeTarget(pusher, pucks, width, height, goalSizes, powerUp) {
    const defaultX = width - (goalSizes.team2 || height * 0.2);
    const defaultY = height / 2;

    // Priority 1: closest puck moving toward AI (vx > 0)
    let closestIncoming = null;
    let minDist = Infinity;
    for (const puck of pucks) {
      if (puck.vx > 0) {
        const dist = Math.hypot(puck.x - pusher.x, puck.y - pusher.y);
        if (dist < minDist) { minDist = dist; closestIncoming = puck; }
      }
    }

    if (closestIncoming) {
      return { ...this._targetForPuck(pusher, closestIncoming, width, height, goalSizes, defaultX - pusher.radius), urgent: true, puck: closestIncoming };
    }

    // Priority 1b: nothing incoming, so it's safe to leave the goal for a speed drop
    if (powerUp && this.rules.collectsPowerUps) {
      return { targetX: powerUp.x, targetY: powerUp.y, urgent: true };
    }

    // Priority 2: any puck already on AI's side
    if (this.rules.chasesOwnSide) {
      let closestOnSide = null;
      let minSideDist = Infinity;
      for (const puck of pucks) {
        if (puck.x > width / 2) {
          const dist = Math.hypot(puck.x - pusher.x, puck.y - pusher.y);
          if (dist < minSideDist) { minSideDist = dist; closestOnSide = puck; }
        }
      }
      if (closestOnSide) {
        return { ...this._targetForPuck(pusher, closestOnSide, width, height, goalSizes, closestOnSide.x - pusher.radius), urgent: true, puck: closestOnSide };
      }
    }

    // Priority 3: anticipatory tracking of puck cluster on opponent's side
    if (this.rules.tracksOpponentSide) {
      const otherSide = pucks.filter(p => p.x <= width / 2);
      if (otherSide.length === 1) {
        return { targetX: defaultX, targetY: otherSide[0].y };
      }
      if (otherSide.length > 1) {
        let bestY = defaultY;
        let maxCount = -1;
        for (const p1 of otherSide) {
          let count = 0, sumY = 0;
          for (const p2 of otherSide) {
            if (Math.abs(p1.y - p2.y) < height * 0.25) { count++; sumY += p2.y; }
          }
          if (count > maxCount) { maxCount = count; bestY = sumY / count; }
        }
        return { targetX: defaultX, targetY: bestY };
      }
    }

    return { targetX: defaultX, targetY: defaultY };
  }

  _targetForPuck(pusher, puck, width, height, goalSizes, fallbackX) {
    if (puck.x > width / 2) {
      const isBehind = pusher.x >= puck.x + pusher.radius * 0.5;

      if (!isBehind && this.rules.getsBehindPuck) {
        // Swing around to get behind the puck before striking
        const ty = pusher.y < puck.y
          ? puck.y - pusher.radius * 2 - 20
          : puck.y + pusher.radius * 2 + 20;
        return {
          targetX: width - pusher.radius,
          targetY: Math.max(pusher.radius, Math.min(height - pusher.radius, ty)),
        };
      }

      // Intercept
      const interceptX = Math.min(puck.x + puck.radius + pusher.radius, width - pusher.radius);
      const ty = this._strikeY(pusher, puck, height, goalSizes);
      return {
        targetX: interceptX,
        targetY: Math.max(pusher.radius, Math.min(height - pusher.radius, ty)),
      };
    }

    // Puck still on opponent's side — hold defensive X, mirror puck's Y
    return {
      targetX: Math.max(pusher.radius, Math.min(width - pusher.radius, fallbackX)),
      targetY: Math.max(pusher.radius, Math.min(height - pusher.radius, puck.y)),
    };
  }

  _strikeY(pusher, puck, height, goalSizes) {
    if (!this.rules.aimsShots) return puck.y;
    const g1 = goalSizes.team1 || height * 0.25;
    const opponentGoalY = puck.y < height / 2 ? g1 / 2 : height - g1 / 2;
    const angle = Math.atan2(opponentGoalY - puck.y, 0 - puck.x);
    return puck.y - Math.sin(angle) * (pusher.radius + puck.radius);
  }
}
