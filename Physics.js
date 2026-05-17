export function resolveCircleCollision(p1, p2, restitution = 1) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const minDist = p1.radius + p2.radius;

  if (distance < minDist && distance > 0) {
    // Separation
    const overlap = minDist - distance;
    const nx = dx / distance;
    const ny = dy / distance;
    
    // Separate them based on mass (if one is pusher, it might have infinite mass)
    const m1 = p1.mass || 1;
    const m2 = p2.mass || 1;
    const sumMass = m1 + m2;
    
    // If mass is Infinity, weight is 0
    const w1 = m1 === Infinity ? 0 : m2 / sumMass;
    const w2 = m2 === Infinity ? 0 : m1 / sumMass;

    if (m1 !== Infinity) {
      p1.x -= nx * overlap * (m2 === Infinity ? 1 : w1);
      p1.y -= ny * overlap * (m2 === Infinity ? 1 : w1);
    }
    if (m2 !== Infinity) {
      p2.x += nx * overlap * (m1 === Infinity ? 1 : w2);
      p2.y += ny * overlap * (m1 === Infinity ? 1 : w2);
    }

    // Velocity reflection
    const dvx = p2.vx - p1.vx;
    const dvy = p2.vy - p1.vy;
    const velocityAlongNormal = dvx * nx + dvy * ny;

    // Do not resolve if velocities are separating
    if (velocityAlongNormal > 0) return;

    const j = -(1 + restitution) * velocityAlongNormal;
    const impulse = j / ((m1 === Infinity ? 0 : 1/m1) + (m2 === Infinity ? 0 : 1/m2));

    const impulseX = impulse * nx;
    const impulseY = impulse * ny;

    if (m1 !== Infinity) {
      p1.vx -= impulseX / m1;
      p1.vy -= impulseY / m1;
    }
    if (m2 !== Infinity) {
      p2.vx += impulseX / m2;
      p2.vy += impulseY / m2;
    }
  }
}

export function constrainPusher(pusher, minX, maxX, minY, maxY) {
  if (pusher.x - pusher.radius < minX) pusher.x = minX + pusher.radius;
  if (pusher.x + pusher.radius > maxX) pusher.x = maxX - pusher.radius;
  if (pusher.y - pusher.radius < minY) pusher.y = minY + pusher.radius;
  if (pusher.y + pusher.radius > maxY) pusher.y = maxY - pusher.radius;
}
