export class CwAudio {
  constructor(frequency = 700) { this.frequency = frequency; this.waveform = 'sine'; this.context = null; this.osc = null; this.gain = null; this.down = false; }
  async unlock() {
    this.context ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.osc) {
      this.osc = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.osc.frequency.value = this.frequency;
      this.osc.type = this.waveform;
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.context.destination);
      this.osc.start();
    }
  }
  async keyDown() {
    if (this.down) return;
    this.down = true;
    await this.unlock();
    if (!this.down) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0.16, now + 0.006);
  }
  keyUp() {
    if (!this.osc || !this.down) return;
    this.down = false;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + 0.008);
  }
  setFrequency(value) { this.frequency = Number(value); if (this.osc) this.osc.frequency.value = this.frequency; }
  setWaveform(value) { this.waveform = ['sine', 'triangle', 'square'].includes(value) ? value : 'sine'; if (this.osc) this.osc.type = this.waveform; }
}
