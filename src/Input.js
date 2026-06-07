export class InputManager {
  constructor(canvas, numPlayers) {
    this.canvas = canvas;
    this.numPlayers = numPlayers;
    this.pointers = new Map(); // key: pointerId, value: {x, y, startX, startY, isDown}
    this.quadrants = [null, null, null, null]; // pointerId currently active in each quadrant

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  cleanup() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  getQuadrantIndex(x, y) {
    if (this.numPlayers === 3) {
      const cx = this.canvas.width / 2;
      const cy = this.canvas.height / 2;
      
      // Radial check
      // Line to bottom middle: x = cx, y > cy
      // Line to top left: x < cx, y = x * (cy/cx) 
      // Line to top right: x > cx, y = (w-x) * (cy/cx)

      if (y < cy) {
        // Upper half
        // Top triangle: y < cy and between the diagonals
        // Slope of TL diagonal is cy/cx. So line is y = cy/cx * x.
        // Above the line means y < cy/cx * x
        const tlLineY = (cy / cx) * x;
        const trLineY = (cy / cx) * (this.canvas.width - x);
        
        if (y < tlLineY && y < trLineY) return 0; // Top Zone
        if (x < cx) return 1; // Left Zone
        return 2; // Right Zone
      } else {
        // Lower half
        if (x < cx) return 1; // Left Zone
        return 2; // Right Zone
      }
    }

    const isRight = x > this.canvas.width / 2;
    const isBottom = y > this.canvas.height / 2;
    if (!isRight && !isBottom) return 0; // Top-Left
    if (!isRight && isBottom) return 1;  // Bottom-Left
    if (isRight && !isBottom) return 2;  // Top-Right
    if (isRight && isBottom) return 3;   // Bottom-Right
    return -1;
  }

  onPointerDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const qIndex = this.getQuadrantIndex(x, y);
    
    this.pointers.set(e.pointerId, {
      x, y, startX: x, startY: y, isDown: true, quadrant: qIndex
    });

    // If this quadrant doesn't have an active primary touch, assign it
    if (qIndex >= 0 && this.quadrants[qIndex] === null) {
      this.quadrants[qIndex] = e.pointerId;
    }
  }

  onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const ptr = this.pointers.get(e.pointerId);
    
    const rect = this.canvas.getBoundingClientRect();
    ptr.x = e.clientX - rect.left;
    ptr.y = e.clientY - rect.top;
  }

  onPointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    
    const ptr = this.pointers.get(e.pointerId);
    if (ptr.quadrant >= 0 && this.quadrants[ptr.quadrant] === e.pointerId) {
      this.quadrants[ptr.quadrant] = null; // Free up the quadrant
    }
    
    this.pointers.delete(e.pointerId);
  }

  getTouchForQuadrant(qIndex) {
    const pointerId = this.quadrants[qIndex];
    if (pointerId !== null && this.pointers.has(pointerId)) {
      return this.pointers.get(pointerId);
    }
    return null;
  }
}
