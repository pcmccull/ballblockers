export const WINNING_SCORE = 10;
export const BASE_SPEED = 300;
export const REFERENCE_SIZE = 900; // px — screen size at which BASE_SPEED was tuned
export const MAX_SPEED = 10;
export const MAX_PUCKS = 10;
export const SPLIT_INTERVAL = 30;
export const POSSESSION_THRESHOLD = 5.0;

export const PUSHER_RADIUS_FRACTION = 0.08;
export const GOAL_SIZE_FRACTION = 0.2;
export const PUCK_RADIUS_FRACTION = 0.04;

export const SPEED_MULTIPLIER_INCREMENT = 0.05;
export const PUCK_RADIUS_SHRINK = 0.97;
export const MIN_PUCK_RADIUS_FRACTION = 0.01;
export const PUSHER_RADIUS_SHRINK = 0.95;
export const MIN_PUSHER_RADIUS_FRACTION = 0.04;
export const GOAL_SIZE_GROWTH = 1.05;
export const MAX_GOAL_SIZE_FRACTION = 0.4;
export const MAX_GOAL_DEPTH = 80;

// Continuous collision: split each frame into sub-steps so a fast puck can't
// tunnel through a pusher, wall, or another puck. Capped to bound worst-case cost.
export const MAX_SUBSTEPS = 16;

// Minimum outward speed (as a fraction of the puck's speed) the puck gets when
// it hits a pusher, so grazing hits cleanly bounce off instead of sticking to
// and sliding around the pusher's edge.
export const PUSHER_MIN_DEFLECT = 20.35;

// Ball momentum: when true, a fast-moving pusher transfers some of its velocity
// to the puck as a temporary speed boost that decays exponentially.
// MOMENTUM_TRANSFER  — fraction of the pusher's normal velocity added as boost.
// MOMENTUM_DECAY     — exponential decay constant (per second); half-life ≈ 0.28 s.
// MOMENTUM_MAX_BOOST_FACTOR — caps the boost at this multiple of targetSpeed.
export const BALL_MOMENTUM = true;
export const MOMENTUM_TRANSFER = 0.25;
export const MOMENTUM_DECAY = 2.5;
export const MOMENTUM_MAX_BOOST_FACTOR = 1.5;
