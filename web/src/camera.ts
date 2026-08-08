export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  private dragging = false;
  private pointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly keys = new Set<string>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  update(deltaSeconds: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy) || 1;
      const worldPixelsPerSecond = 850 / this.zoom;
      this.x += (dx / length) * worldPixelsPerSecond * deltaSeconds;
      this.y += (dy / length) * worldPixelsPerSecond * deltaSeconds;
    }
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(4, Math.max(0.35, zoom));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add("dragging");
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    this.canvas.classList.remove("dragging");
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const beforeX = this.x + (pointerX - rect.width / 2) / this.zoom;
    const beforeY = this.y + (pointerY - rect.height / 2) / this.zoom;

    const scale = Math.exp(-event.deltaY * 0.0012);
    this.zoom = Math.min(4, Math.max(0.35, this.zoom * scale));

    this.x = beforeX - (pointerX - rect.width / 2) / this.zoom;
    this.y = beforeY - (pointerY - rect.height / 2) / this.zoom;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
