// Pixel-drop title effect: the screen is divided into a grid of large "pixels",
// and the cells that make up an <h1>'s text fall in from the top of the screen
// to build the letters. The real <h1> stays in the DOM for layout/accessibility
// but is made invisible while the canvas draws the pixelated version.

const GRAVITY = 5200;          // px/s^2
const COLUMN_SWEEP = 0.9;      // seconds for the drop wave to cross the text
const ROW_STAGGER = 0.035;     // seconds between stacked cells in one column
const FLASH_TIME = 0.25;       // seconds a cell glows white after landing
const GRADIENT = ['#00ffff', '#ff00ff'];

// Hand-drawn 5x7 bitmap font. Sampling a vector font at this resolution turns
// letters to mush, so every glyph is designed for the pixel grid.
const GLYPH_HEIGHT = 7;
const LETTER_GAP = 1;
const LINE_GAP = 3;
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  ':': ['.', '#', '.', '.', '.', '#', '.'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
  '😞': ['.#####.', '#.....#', '#.#.#.#', '#.....#', '#.###.#', '##...##', '.#####.'],
};

function textWidthInCells(text) {
  let width = 0;
  for (const ch of text) width += (FONT[ch] || FONT['?'])[0].length + LETTER_GAP;
  return Math.max(0, width - LETTER_GAP);
}

// Grid positions of every lit font pixel for the given lines, centred on
// (centerX, centerY) and snapped to a screen-aligned grid of `cell` pixels.
function cellsForLines(lines, cell, centerX, centerY) {
  const textRows = lines.length * GLYPH_HEIGHT + (lines.length - 1) * LINE_GAP;
  const top = Math.round((centerY - (textRows * cell) / 2) / cell) * cell;
  const cells = [];
  lines.forEach((l, lineIndex) => {
    const lineCols = textWidthInCells(l);
    let col = Math.round((centerX - (lineCols * cell) / 2) / cell);
    const row0 = top / cell + lineIndex * (GLYPH_HEIGHT + LINE_GAP);
    for (const ch of l) {
      const glyph = FONT[ch] || FONT['?'];
      glyph.forEach((rowBits, r) => {
        for (let c = 0; c < rowBits.length; c++) {
          if (rowBits[c] === '#') cells.push({ x: (col + c) * cell, y: (row0 + r) * cell });
        }
      });
      col += glyph[0].length + LETTER_GAP;
    }
  });
  return cells;
}

// Turn grid cells into blocks that fall from above the screen. colorAt(t)
// gives each block's colour from its 0..1 position across the text.
function makeDropBlocks(cells, cell, colorAt) {
  if (!cells.length) return [];
  const minX = Math.min(...cells.map(c => c.x));
  const spanX = Math.max(1, Math.max(...cells.map(c => c.x)) - minX);
  const maxY = Math.max(...cells.map(c => c.y));
  return cells.map(c => {
    const t = (c.x - minX) / spanX;
    const rowsFromBottom = (maxY - c.y) / cell;
    return {
      x: c.x,
      targetY: c.y,
      startY: -cell - Math.random() * cell * 4,
      // Sweep left-to-right; within a column, lower cells land first so the
      // letters stack up from the bottom like falling blocks
      delay: t * COLUMN_SWEEP + rowsFromBottom * ROW_STAGGER + Math.random() * 0.05,
      color: colorAt(t),
      landedAt: null,
    };
  });
}

// Fall position and landing flash of a block `elapsed` seconds into the drop.
// Returns null while the block is still waiting to start falling.
function dropState(b, elapsed) {
  const t = elapsed - b.delay;
  if (t < 0) return null;
  const y = b.startY + 0.5 * GRAVITY * t * t;
  if (y < b.targetY) return { y, flash: 0, settled: false };
  if (b.landedAt === null) b.landedAt = elapsed;
  const flash = Math.max(0, 1 - (elapsed - b.landedAt) / FLASH_TIME) * 0.8;
  return { y: b.targetY, flash, settled: flash === 0 };
}

export function drawBlock(ctx, x, y, cell, color, flash) {
  const size = cell - 1; // 1px gap keeps the chunky pixel look
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  // Bevel highlight on the top edge
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(x, y, size, Math.max(1, cell / 6));
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
    ctx.fillRect(x, y, size, size);
  }
}

function lerpColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
  const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
  const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
  return `rgb(${r},${g},${bl})`;
}

class PixelDropTitle {
  constructor(heading) {
    this.heading = heading;
    this.overlay = heading.closest('.overlay');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pixel-drop-canvas';
    this.overlay.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.blocks = [];
    this.rafId = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    heading.classList.add('pixel-drop-source');
    this.tick = this.tick.bind(this);
  }

  // Lay the heading text out in the bitmap font, centred on the heading's
  // on-screen position and snapped to the screen grid. Each lit font pixel
  // becomes a falling block.
  layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.overlay.clientWidth;
    const h = this.overlay.clientHeight;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const style = getComputedStyle(this.heading);
    const fontSize = parseFloat(style.fontSize);
    const maxWidth = w - 40;

    let text = this.heading.textContent.trim();
    if (style.textTransform === 'uppercase') text = text.toUpperCase();
    const words = text.split(/\s+/);

    // Cell size scales with the CSS font size, shrinking only if a single
    // word would not fit across the screen
    let cell = Math.max(4, Math.round(fontSize / 7));
    const longestWord = Math.max(...words.map(textWidthInCells));
    while (cell > 2 && longestWord * cell > maxWidth) cell--;
    this.cell = cell;

    // Wrap words into lines that fit the screen
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && textWidthInCells(test) * cell > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    // Reserve enough height in the DOM so the buttons below never overlap
    const textRows = lines.length * GLYPH_HEIGHT + (lines.length - 1) * LINE_GAP;
    this.heading.style.minHeight = `${textRows * cell}px`;

    const overlayRect = this.overlay.getBoundingClientRect();
    const rect = this.heading.getBoundingClientRect();
    this.layoutTop = rect.top;
    const centerX = rect.left - overlayRect.left + rect.width / 2;
    const centerY = rect.top - overlayRect.top + rect.height / 2;

    const color = this.heading.style.color;
    this.blocks = makeDropBlocks(cellsForLines(lines, cell, centerX, centerY), cell,
      t => color || lerpColor(GRADIENT[0], GRADIENT[1], t));
  }

  play() {
    this.stop();
    this.layout();
    if (this.reducedMotion) {
      this.drawFinal();
      return;
    }
    this.startTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // Re-layout without replaying, e.g. after a resize
  snapToFinal() {
    this.stop();
    this.layout();
    this.drawFinal();
  }

  drawGrid() {
    const { ctx, cell, width, height } = this;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += cell) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += cell) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }

  tick(now) {
    const elapsed = (now - this.startTime) / 1000;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid();

    let allLanded = true;
    for (const b of this.blocks) {
      const s = dropState(b, elapsed);
      if (!s || !s.settled) allLanded = false;
      if (s) drawBlock(ctx, b.x, s.y, this.cell, b.color, s.flash);
    }

    if (allLanded) {
      this.rafId = null;
      this.drawFinal();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  drawFinal() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid();
    // One glow pass under the blocks, then crisp blocks on top
    ctx.save();
    ctx.shadowBlur = this.cell * 2;
    for (const b of this.blocks) {
      ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.targetY, this.cell - 1, this.cell - 1);
    }
    ctx.restore();
    for (const b of this.blocks) drawBlock(ctx, b.x, b.targetY, this.cell, b.color, 0);
  }
}

const INTRO_HOLD = 0.8;        // seconds the team names sit fully built
const INTRO_EXIT = 0.9;        // seconds for the blocks to blast away and fade
const EXIT_STAGGER = 0.15;     // random spread in when each block takes off

// Pre-game intro drawn over the game canvas: each team's name drops into its
// play area block by block, holds, then the blocks burst outward and fade.
// `teams` is [{ name, color, x, y, width, height }] in screen pixels, where
// (x, y) is the centre of the team's area and width/height its size.
export class TeamIntro {
  constructor(teams) {
    this.elapsed = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.groups = teams.map(team => {
      // Use one line, or one word per line if that lets the blocks be bigger
      // (narrow areas such as the 3-player wedges in portrait)
      const layouts = [[team.name], team.name.split(' ')].map(lines => {
        const cols = Math.max(...lines.map(textWidthInCells));
        const rows = lines.length * GLYPH_HEIGHT + (lines.length - 1) * LINE_GAP;
        const cell = Math.max(3, Math.min(28,
          Math.floor((team.width * 0.8) / cols),
          Math.floor((team.height * 0.5) / rows)));
        return { lines, cell };
      });
      const { lines, cell } = layouts[1].cell > layouts[0].cell ? layouts[1] : layouts[0];
      const blocks = makeDropBlocks(cellsForLines(lines, cell, team.x, team.y), cell, () => team.color);
      for (const b of blocks) {
        // Burst direction: away from the name's centre, with an upward kick
        const dx = b.x - team.x;
        const dy = b.targetY - team.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = cell * (25 + Math.random() * 35);
        b.vx = (dx / len) * speed + (Math.random() - 0.5) * cell * 20;
        b.vy = (dy / len) * speed - cell * (20 + Math.random() * 30);
        b.spin = (Math.random() - 0.5) * 12;
        b.exitDelay = Math.random() * EXIT_STAGGER;
      }
      return { cell, blocks };
    });

    const lastLanding = Math.max(0, ...this.groups.flatMap(g => g.blocks.map(b => {
      // Time for a block to fall from its start to its target, plus its delay
      return b.delay + Math.sqrt((2 * (b.targetY - b.startY)) / GRAVITY);
    })));
    this.exitStart = this.reducedMotion ? INTRO_HOLD : lastLanding + FLASH_TIME + INTRO_HOLD;
    this.duration = this.exitStart + EXIT_STAGGER + INTRO_EXIT;
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  update(dt) {
    this.elapsed += dt;
  }

  draw(ctx) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const { cell, blocks } of this.groups) {
      for (const b of blocks) {
        const exitT = this.elapsed - this.exitStart - b.exitDelay;
        if (exitT > 0) {
          this.drawExitingBlock(ctx, b, cell, exitT);
          continue;
        }
        if (this.reducedMotion) {
          drawBlock(ctx, b.x, b.targetY, cell, b.color, 0);
          continue;
        }
        const s = dropState(b, this.elapsed);
        if (s) drawBlock(ctx, b.x, s.y, cell, b.color, s.flash);
      }
    }
    ctx.restore();
  }

  drawExitingBlock(ctx, b, cell, t) {
    const life = 1 - t / INTRO_EXIT;
    if (life <= 0) return;
    ctx.save();
    ctx.globalAlpha = life;
    if (this.reducedMotion) {
      drawBlock(ctx, b.x, b.targetY, cell, b.color, 0);
    } else {
      const x = b.x + b.vx * t;
      const y = b.targetY + b.vy * t + 0.5 * GRAVITY * t * t;
      const half = cell / 2;
      ctx.translate(x + half, y + half);
      ctx.rotate(b.spin * t);
      // Brief white-hot flash as the block takes off
      drawBlock(ctx, -half, -half, cell, b.color, Math.max(0, 0.8 - t * 5));
    }
    ctx.restore();
  }
}

// Attach the effect to every overlay heading marked with data-pixel-drop.
// It replays whenever its overlay becomes active or the heading text changes.
export function initPixelDropTitles() {
  const titles = [...document.querySelectorAll('.overlay h1[data-pixel-drop]')]
    .map(h => new PixelDropTitle(h));

  const isActive = t => t.overlay.classList.contains('active');

  const playWhenReady = t => {
    // Wait for web fonts so the heading's DOM size (and so its position) is final
    document.fonts.ready.then(() => {
      if (isActive(t)) t.play();
    });
  };

  for (const t of titles) {
    let wasActive = isActive(t);
    new MutationObserver(() => {
      const active = isActive(t);
      if (active && !wasActive) playWhenReady(t);
      if (!active) t.stop();
      wasActive = active;
    }).observe(t.overlay, { attributes: true, attributeFilter: ['class'] });

    new MutationObserver(() => {
      if (isActive(t)) playWhenReady(t);
    }).observe(t.heading, { childList: true, characterData: true, subtree: true });

    if (wasActive) playWhenReady(t);

    // Content appearing after the title is laid out (e.g. the Install App
    // button, which only shows once the browser fires beforeinstallprompt)
    // re-centres the overlay and moves the heading, so follow it.
    const followHeading = () => {
      if (!isActive(t) || !t.blocks.length) return;
      if (t.heading.getBoundingClientRect().top === t.layoutTop) return;
      if (t.rafId !== null) t.layout(); // mid-drop: retarget, keep animating
      else t.snapToFinal();
    };
    const observer = new ResizeObserver(followHeading);
    for (const child of t.overlay.children) observer.observe(child);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const t of titles) {
        if (isActive(t)) t.snapToFinal();
      }
    }, 100);
  });
}

const SCORE_FLY_TIME = 0.35;   // seconds for a score block to fly in from the edge
const SCORE_COL_STAGGER = 0.03; // seconds between successive columns arriving
const SCORE_EXIT_TIME = 0.35;  // seconds for the old score to be pushed off and fade
const SCORE_REST_ALPHA = 0.5;  // scores sit dimmed between changes
const SCORE_DIM_TIME = 0.6;    // seconds to fade from full brightness back to rest

// One team's score, drawn in the bitmap font. When the number changes, the
// new blocks fly in from the screen edge the score sits against and push the
// old number off towards the middle of the screen.
class PixelScore {
  constructor(el) {
    this.el = el;
    this.value = el.textContent.trim();
    this.blocks = [];
    this.leaving = [];
    this.changedAt = -Infinity;
    // Read the team colour before the source text is made transparent
    this.color = getComputedStyle(el).color;
    el.classList.add('pixel-score-source');
  }

  get visible() {
    return getComputedStyle(this.el).display !== 'none';
  }

  // Which screen edge the score is nearest, as the unit direction pointing
  // from that edge into the screen
  inwardDirection(cx, cy, w, h) {
    const edges = [
      { d: cx, dir: { x: 1, y: 0 } },
      { d: w - cx, dir: { x: -1, y: 0 } },
      { d: cy, dir: { x: 0, y: 1 } },
      { d: h - cy, dir: { x: 0, y: -1 } },
    ];
    return edges.reduce((a, b) => (b.d < a.d ? b : a)).dir;
  }

  layout(boardRect, now, animate) {
    const rect = this.el.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(this.el).fontSize);
    const cell = Math.max(3, Math.round(fontSize / 7));
    const cx = rect.left - boardRect.left + rect.width / 2;
    const cy = rect.top - boardRect.top + rect.height / 2;
    const w = boardRect.width;
    const h = boardRect.height;
    const dir = this.inwardDirection(cx, cy, w, h);
    this.cell = cell;
    this.dir = dir;

    const cells = cellsForLines([this.value], cell, cx, cy);
    // Distance of each cell into the screen from the entry edge; the deepest
    // cells arrive first so the number fills in back-to-front
    const depth = c => c.x * dir.x + c.y * dir.y;
    const maxDepth = Math.max(...cells.map(depth));
    this.blocks = cells.map(c => {
      // Start just off the entry edge, in line with the block's target
      const travel = dir.x > 0 ? c.x + cell
        : dir.x < 0 ? w - c.x
          : dir.y > 0 ? c.y + cell
            : h - c.y;
      const extra = travel + Math.random() * cell * 4;
      return {
        x: c.x,
        y: c.y,
        sx: c.x - dir.x * extra,
        sy: c.y - dir.y * extra,
        delay: animate ? ((maxDepth - depth(c)) / cell) * SCORE_COL_STAGGER + Math.random() * 0.04 : -Infinity,
      };
    });
    if (animate) this.changedAt = now;
  }

  setValue(value, boardRect, now) {
    if (value === this.value) return;
    // The current blocks get pushed off in the same direction the new ones travel
    this.leaving = this.blocks.map(b => ({ x: b.x, y: b.y }));
    this.leavingAt = now;
    this.leavingCell = this.cell;
    this.value = value;
    this.layout(boardRect, now, true);
  }

  // Returns true while anything is still moving
  draw(ctx, now) {
    const elapsed = (now - this.changedAt) / 1000;
    let animating = false;

    // Old score sliding away and fading
    const lt = (now - this.leavingAt) / 1000;
    if (this.leaving.length && lt < SCORE_EXIT_TIME) {
      animating = true;
      const p = lt / SCORE_EXIT_TIME;
      const push = this.leavingCell * 10 * p * p;
      ctx.globalAlpha = 1 - p;
      for (const b of this.leaving) {
        drawBlock(ctx, b.x + this.dir.x * push, b.y + this.dir.y * push, this.leavingCell, this.color, 0);
      }
    } else {
      this.leaving = [];
    }

    // Bright while arriving, then easing back down to the resting dim level
    let lastArrival = 0;
    for (const b of this.blocks) lastArrival = Math.max(lastArrival, b.delay + SCORE_FLY_TIME);
    const sinceArrival = elapsed - lastArrival - FLASH_TIME;
    const dim = Math.min(1, Math.max(0, sinceArrival / SCORE_DIM_TIME));
    ctx.globalAlpha = 1 - (1 - SCORE_REST_ALPHA) * dim;
    if (dim < 1) animating = true;

    for (const b of this.blocks) {
      const t = elapsed - b.delay;
      if (t < 0) continue;
      const p = Math.min(1, t / SCORE_FLY_TIME);
      const e = 1 - Math.pow(1 - p, 3); // ease-out: fast from the edge, settles into place
      const flash = p < 1 ? 0 : Math.max(0, 1 - (t - SCORE_FLY_TIME) / FLASH_TIME) * 0.8;
      drawBlock(ctx, b.sx + (b.x - b.sx) * e, b.sy + (b.y - b.sy) * e, this.cell, this.color, flash);
    }
    ctx.globalAlpha = 1;
    return animating;
  }
}

// Draws every .team-score element inside #score-board as pixel blocks and
// animates changes to their text. The DOM elements stay for layout only.
export function initPixelScores() {
  const board = document.getElementById('score-board');
  const canvas = document.createElement('canvas');
  canvas.className = 'pixel-score-canvas';
  board.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const scores = [...board.querySelectorAll('.team-score')].map(el => new PixelScore(el));
  let rafId = null;
  let boardRect;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    boardRect = board.getBoundingClientRect();
    canvas.width = Math.round(boardRect.width * dpr);
    canvas.height = Math.round(boardRect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now();
    for (const s of scores) if (s.visible) s.layout(boardRect, now, false);
  };

  const frame = now => {
    ctx.clearRect(0, 0, boardRect.width, boardRect.height);
    let animating = false;
    for (const s of scores) {
      if (s.visible && s.draw(ctx, now)) animating = true;
    }
    rafId = animating ? requestAnimationFrame(frame) : null;
  };
  const render = () => {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  };

  for (const s of scores) {
    // Text changes animate in; showing/hiding (the 3-player score) just re-lays out
    new MutationObserver(() => {
      if (!s.visible) {
        s.value = s.el.textContent.trim();
        return render();
      }
      s.setValue(s.el.textContent.trim(), boardRect, performance.now());
      render();
    }).observe(s.el, { childList: true, characterData: true, subtree: true });
    new MutationObserver(() => {
      if (s.visible) s.layout(boardRect, performance.now(), false);
      render();
    }).observe(s.el, { attributes: true, attributeFilter: ['style'] });
  }

  window.addEventListener('resize', () => {
    resize();
    render();
  });
  document.fonts.ready.then(() => {
    resize();
    render();
  });
  resize();
  render();
}
