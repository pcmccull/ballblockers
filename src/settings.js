export const WINNING_SCORE = 20;
export const BASE_SPEED = 300;
export const REFERENCE_SIZE = 900; // px — screen size at which BASE_SPEED was tuned
export const MAX_SPEED = 10;
export const MAX_PUCKS = 20;
export const SPLIT_INTERVAL = 30;
export const POSSESSION_THRESHOLD = 5.0;
export const PUCK_SPAWN_INTERVAL = 60;

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

export const IMPACT_REPULSION_MULTIPLIER = 1.5; // Multiplier on baseSpeed for how hard the puck gets pushed by the pusher
export const MAX_IMPACT_SPEED_MULTIPLIER = 3.0; // The maximum speed the puck can reach when hit (multiple of targetSpeed)
export const PUCK_FRICTION = 3.0; // Decay rate per second to return to base speed
