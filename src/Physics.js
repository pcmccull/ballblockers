// Elastic collision + positional separation between two circles.
// Each body needs { x, y, vx, vy, radius, mass }. A mass of Infinity is
// treated as immovable (e.g. a pusher), so it neither moves nor changes velocity.
// Returns false when the circles are not overlapping. Otherwise returns
// { overlapped: true, impulse } where `impulse` is true only when an actual
// velocity response was applied (the bodies were approaching), and false when
// they were already separating and only positional separation happened.
export function resolveCircleCollision(a, b, restitution = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius;

  if (dist >= minDist) return false;
  
  // Collision normal pointing from a to b. If the centers coincide, pick an
  // arbitrary normal and treat the pair as fully overlapped.
  let nx, ny;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    nx = 1;
    ny = 0;
    dist = 0;
  }
  

  const ma = a.mass ?? 1;
  const mb = b.mass ?? 1;
  const invA = ma === Infinity ? 0 : 1 / ma;
  const invB = mb === Infinity ? 0 : 1 / mb;
  const invSum = invA + invB;
  if (invSum === 0) return { overlapped: true, impulse: false }; // two immovable bodies, nothing to do

  // Positional separation: push the bodies apart so they no longer overlap,
  // distributing the correction by inverse mass (immovable bodies stay put).
  const overlap = minDist - dist;
  a.x -= nx * overlap * (invA / invSum);
  a.y -= ny * overlap * (invA / invSum);
  b.x += nx * overlap * (invB / invSum);
  b.y += ny * overlap * (invB / invSum);

  // Velocity response: only resolve if the bodies are approaching.
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const relNormal = rvx * nx + rvy * ny;
  if (relNormal > 0) return { overlapped: true, impulse: false }; // already separating

  const j = -(1 + restitution) * relNormal / invSum;
  const ix = j * nx;
  const iy = j * ny;

  a.vx -= ix * invA;
  a.vy -= iy * invA;
  b.vx += ix * invB;
  b.vy += iy * invB;

  return { overlapped: true, impulse: true };
}

export function constrainPusher(pusher, minX, maxX, minY, maxY) {
  if (pusher.x - pusher.radius < minX) pusher.x = minX + pusher.radius;
  if (pusher.x + pusher.radius > maxX) pusher.x = maxX - pusher.radius;
  if (pusher.y - pusher.radius < minY) pusher.y = minY + pusher.radius;
  if (pusher.y + pusher.radius > maxY) pusher.y = maxY - pusher.radius;
}
