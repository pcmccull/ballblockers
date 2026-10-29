export const WINNING_SCORE = 7;
export const BASE_SPEED = 300;
export const REFERENCE_SIZE = 900; // px — screen size at which BASE_SPEED was tuned
export const MAX_SPEED = 10;
export const MAX_PUCKS = 10;
export const SPLIT_INTERVAL = 20;
export const SPLIT_WARNING_TIME = 2.5; // seconds before a split that the puck starts throbbing
export const SPLIT_PINCH_TIME = 1.2; // seconds before a split that it pinches into two lobes

export const THREE_PLAYER_SPLIT_Y_FRACTION = 0.62; // radial center Y as fraction of height; higher = larger yellow (top) zone

export const PUSHER_RADIUS_FRACTION = 0.08;
export const PUSHER_APPEAR_DURATION = 0.5; // seconds for each pusher to pop in at game start
export const PUSHER_APPEAR_STAGGER = 0.15; // delay between successive pushers popping in
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

// Pusher speed & stamina: a pusher's top speed scales with its stamina, so
// constant fast swiping wears it down and leaves it slow when it matters.
// Speeds are multiples of baseSpeed * speedMultiplier (i.e. relative to puck speed).
// PUSHER_MAX_SPEED_FACTOR       — top speed with a full stamina bar.
// PUSHER_EXHAUSTED_SPEED_FACTOR — top speed with an empty stamina bar.
// STAMINA_DRAIN_RATE            — stamina lost per second when moving at full top speed
//                                 (scales linearly with speed, so any movement costs something).
// STAMINA_REGEN_RATE            — stamina regained per second while standing still.
// STAMINA_REGEN_DELAY           — seconds after the last drain before regen starts.
// Stamina runs from 0 (empty) to 1 (full).
export const PUSHER_MAX_SPEED_FACTOR = 3.0;
export const PUSHER_EXHAUSTED_SPEED_FACTOR = 1.2;
export const STAMINA_DRAIN_RATE = 0.9;
export const STAMINA_REGEN_RATE = 0.4;
export const STAMINA_REGEN_DELAY = 0.4;
// 3-player games use a much smaller stamina tank: each pusher guards two
// borders, so constant fast swiping should run it dry almost immediately.
export const THREE_PLAYER_STAMINA_DRAIN_RATE = 3.0;
export const THREE_PLAYER_STAMINA_REGEN_RATE = 0.25;

// Speed power-up: a drop appears at a random spot on the center line between
// zones, the farthest a pusher can go from its goal. The first pusher
// to touch it gets the boost, so collecting it means leaving the goal open.
// While boosted, a pusher's stamina is frozen full and its top speed is
// POWERUP_SPEED_FACTOR (same units as PUSHER_MAX_SPEED_FACTOR). 8 matches the old
// uncapped feel the physics sub-stepping was tuned for; Infinity removes the cap
// entirely but very fast pushers can tunnel through small pucks.
export const POWERUP_SPAWN_MIN_DELAY = 15;   // seconds between a drop ending and the next one appearing
export const POWERUP_SPAWN_MAX_DELAY = 30;
export const POWERUP_LIFETIME = 10;          // seconds an uncollected drop stays on the board
export const POWERUP_DURATION = 10;          // seconds of boost once collected
export const POWERUP_SPEED_FACTOR = 8;
export const POWERUP_RADIUS_FRACTION = 0.05; // drop size as a fraction of min(width, height)
export const POWERUP_LINE_MARGIN = 0.12;     // fraction of the center line kept clear at the wall end(s)

// Cross power-up: a second kind of drop (green, double arrow) that spawns the
// same way as the speed drop. Its collector can leave its zone and roam the
// whole board for CROSS_DURATION seconds; when that ends it is steered back
// home at CROSS_RETURN_SPEED_FACTOR (× puck speed) and can't be controlled
// until it is back inside its zone.
export const POWERUP_CROSS_CHANCE = 0.5;     // probability a spawned drop is a cross drop rather than speed
export const CROSS_DURATION = 6;
export const CROSS_RETURN_SPEED_FACTOR = 2.5;
