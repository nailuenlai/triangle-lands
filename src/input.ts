/**
 * Unified input: dynamic virtual joystick (left side touch), drag-to-look
 * (right side touch / mouse), and keyboard for desktop.
 */
export class Input {
  move = { x: 0, y: 0 };
  jump = false;
  action = false;
  map = false;
  /** Held: sprint on ground / dash-swim / dive while gliding. */
  sprint = false;
  private sprintBtn = false;
  private look = { x: 0, y: 0 };
  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private readonly joyRadius = 56;
  onFirstMove: (() => void) | null = null;

  constructor(layer: HTMLElement, private joyBase: HTMLElement, private joyKnob: HTMLElement) {
    layer.addEventListener('pointerdown', (e) => {
      const touchLike = e.pointerType !== 'mouse';
      if (touchLike && this.joyId === null && e.clientX < window.innerWidth * 0.45) {
        this.joyId = e.pointerId;
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joyVec = { x: 0, y: 0 };
        this.joyBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.joyBase.classList.add('active');
        this.joyKnob.style.transform = 'translate(-50%, -50%)';
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
      } else return;
      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) {
        let dx = e.clientX - this.joyOrigin.x;
        let dy = e.clientY - this.joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > this.joyRadius) { dx *= this.joyRadius / len; dy *= this.joyRadius / len; }
        this.joyVec = { x: dx / this.joyRadius, y: -dy / this.joyRadius };
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.lookId) {
        const k = e.pointerType === 'mouse' ? 1 : 1.25;
        this.look.x += (e.clientX - this.lookLast.x) * k;
        this.look.y += (e.clientY - this.lookLast.y) * k;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.joyVec = { x: 0, y: 0 };
        this.joyBase.classList.remove('active');
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);

    const prevent = (e: Event) => e.preventDefault();
    layer.addEventListener('touchstart', prevent, { passive: false });
    layer.addEventListener('touchmove', prevent, { passive: false });
    layer.addEventListener('touchend', prevent, { passive: false });

    // Prevent browser pinch-zoom and double-tap zoom (especially iOS Safari,
    // which ignores user-scalable=no and does not cancel touch gestures via
    // pointerdown.preventDefault()). Keep single-finger clicks on title buttons working.
    document.addEventListener('gesturestart', prevent, { passive: false });
    document.addEventListener('gesturechange', prevent, { passive: false });
    document.addEventListener('gestureend', prevent, { passive: false });
    document.addEventListener('dblclick', prevent);
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1 || ('scale' in e && (e as TouchEvent & { scale: number }).scale !== 1)) {
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jump = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.action = true;
      if (e.code === 'KeyM' || e.code === 'Tab') { this.map = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.sprintBtn = false; });
  }

  private preventTouchDefaults(el: HTMLElement) {
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', prevent, { passive: false });
    el.addEventListener('touchend', prevent, { passive: false });
    el.addEventListener('dblclick', prevent);
  }

  bindButton(el: HTMLElement, fn: () => void) {
    this.preventTouchDefaults(el);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  /** A press-and-hold button (touch sprint). */
  bindHold(el: HTMLElement, onDown?: () => void) {
    this.preventTouchDefaults(el);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      this.sprintBtn = true;
      el.classList.add('held');
      onDown?.();
    });
    const up = () => { this.sprintBtn = false; el.classList.remove('held'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  consumeLook() {
    const d = { ...this.look };
    this.look.x = 0; this.look.y = 0;
    return d;
  }

  update() {
    let x = this.joyVec.x, y = this.joyVec.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move = { x, y };
    this.sprint = this.sprintBtn || k.has('ShiftLeft') || k.has('ShiftRight');
    if (len > 0.1 && this.onFirstMove) { this.onFirstMove(); this.onFirstMove = null; }
  }

  clearPresses() { this.jump = false; this.action = false; this.map = false; }
}
