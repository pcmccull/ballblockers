// AI difficulty presets — each rule can be toggled independently
export const AI_DIFFICULTY = {
  easy: {
    speedFactor: 0.9,          // multiplier on baseSpeed * speedMultiplier
    getsBehindPuck: false,     // reposition behind puck before striking
    aimsShots: false,          // calculate aimed shots toward opponent's goal
    tracksOpponentSide: false, // anticipate by mirroring puck clusters on opponent's side
    chasesOwnSide: true,       // chase pucks already on AI's side
  },
  medium: {
    speedFactor: 1.3,
    getsBehindPuck: true,
    aimsShots: false,
    tracksOpponentSide: true,
    chasesOwnSide: true,
  },
  hard: {
    speedFactor: 1.5,
    getsBehindPuck: true,
    aimsShots: true,
    tracksOpponentSide: true,
    chasesOwnSide: true,
  },
};

export class AIController {
  constructor(rules = AI_DIFFICULTY.hard) {
    this.rules = rules;
  }

  update(pusher, pucks, gameState, dt) {
    const { width, height, goalSizes, baseSpeed, speedMultiplier } = gameState;
    const { targetX, targetY } = this._computeTarget(pusher, pucks, width, height, goalSizes);

    const aiSpeed = baseSpeed * this.rules.speedFactor * speedMultiplier;
    const dx = targetX - pusher.x;
    const dy = targetY - pusher.y;
    const dist = Math.hypot(dx, dy);

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

  _computeTarget(pusher, pucks, width, height, goalSizes) {
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
      return this._targetForPuck(pusher, closestIncoming, width, height, goalSizes, defaultX - pusher.radius);
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
        return this._targetForPuck(pusher, closestOnSide, width, height, goalSizes, closestOnSide.x - pusher.radius);
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
