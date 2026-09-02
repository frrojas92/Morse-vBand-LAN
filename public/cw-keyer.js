const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

export class CwKeyer {
  constructor(onKey) {
    this.onKey = onKey;
    this.mode = 'iambic-b';
    this.wpm = 15;
    this.paddles = { dit: false, dah: false };
    this.memory = { dit: false, dah: false };
    this.running = false;
    this.last = 'dah';
    this.straightDown = false;
    this.currentElement = null;
    this.squeezeSeen = false;
  }
  configure(mode, wpm) { this.mode = mode; this.wpm = Number(wpm); }
  setPaddle(paddle, pressed) {
    if (this.paddles[paddle] === pressed) return;
    this.paddles[paddle] = pressed;
    if (this.mode === 'straight') return this.handleStraight();
    if (pressed) this.memory[paddle] = true;
    if (this.paddles.dit && this.paddles.dah) this.squeezeSeen = true;
    if (!pressed && !this.paddles.dit && !this.paddles.dah && this.squeezeSeen) {
      this.memory.dit = this.memory.dah = false;
      if (this.mode === 'iambic-b' && this.currentElement) {
        this.memory[this.currentElement === 'dit' ? 'dah' : 'dit'] = true;
      }
    }
    if (!this.running && pressed) this.run();
  }
  handleStraight() {
    const down = this.paddles.dit || this.paddles.dah;
    if (down === this.straightDown) return;
    this.straightDown = down;
    this.onKey(down);
  }
  chooseElement() {
    const dit = this.paddles.dit || this.memory.dit;
    const dah = this.paddles.dah || this.memory.dah;
    if (dit && dah) return this.last === 'dit' ? 'dah' : 'dit';
    if (dit) return 'dit';
    if (dah) return 'dah';
    return null;
  }
  async run() {
    this.running = true;
    while (true) {
      const element = this.chooseElement();
      if (!element) break;
      this.currentElement = element;
      this.squeezeSeen = this.paddles.dit && this.paddles.dah;
      this.memory[element] = false;
      this.last = element;
      const ditMs = 1200 / this.wpm;
      await this.onKey(true);
      await wait(ditMs * (element === 'dah' ? 3 : 1));
      await this.onKey(false);
      await wait(ditMs);
      this.currentElement = null;
      this.squeezeSeen = false;
    }
    this.running = false;
    if (this.paddles.dit || this.paddles.dah) this.run();
  }
  releaseAll() {
    this.paddles.dit = this.paddles.dah = false;
    this.memory.dit = this.memory.dah = false;
    if (this.mode === 'straight' && this.straightDown) { this.straightDown = false; this.onKey(false); }
  }
}
