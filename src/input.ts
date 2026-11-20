/**
 * Unified input: dynamic virtual joystick (left side touch), drag-to-look
 * (right side touch / mouse), and keyboard for desktop.
 */
export class Input {
  move = { x: 0, y: 0 };
  jump = false;
  action = false;
  map = false;
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

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jump = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.action = true;
      if (e.code === 'KeyM' || e.code === 'Tab') { this.map = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindButton(el: HTMLElement, fn: () => void) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
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
    if (len > 0.1 && this.onFirstMove) { this.onFirstMove(); this.onFirstMove = null; }
  }

  clearPresses() { this.jump = false; this.action = false; this.map = false; }
}
