export class CwAudio {
  constructor(frequency = 700) { this.frequency = frequency; this.waveform = 'sine'; this.context = null; this.osc = null; this.gain = null; this.down = false; this.remoteServerAt = null; this.remoteAudioAt = null; }
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
    if (!this.down) return;
    this.down = false;
    if (!this.osc) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + 0.008);
  }
  async scheduleRemoteKey(down, serverAt, durationMs = null) {
    await this.unlock();
    const now = this.context.currentTime;
    if (down || this.remoteServerAt === null) {
      this.remoteServerAt = Number(serverAt) || Date.now();
      this.remoteAudioAt = now + 0.075;
    }
    const measuredEnd = durationMs && this.remoteAudioAt + Math.min(2000, Math.max(10, Number(durationMs))) / 1000;
    const mappedTime = this.remoteAudioAt + ((Number(serverAt) || this.remoteServerAt) - this.remoteServerAt) / 1000;
    const target = Math.max(now + 0.003, down ? mappedTime : (measuredEnd || mappedTime));
    if (down) {
      this.gain.gain.cancelScheduledValues(target);
      this.gain.gain.setValueAtTime(0, target);
      this.gain.gain.linearRampToValueAtTime(0.12, target + 0.012);
    } else {
      const releaseStart = target - 0.014;
      if (releaseStart <= now) {
        if (typeof this.gain.gain.cancelAndHoldAtTime === 'function') this.gain.gain.cancelAndHoldAtTime(now);
        else this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.linearRampToValueAtTime(0, now + 0.014);
      } else {
        this.gain.gain.cancelScheduledValues(releaseStart);
        this.gain.gain.setValueAtTime(0.12, releaseStart);
        this.gain.gain.linearRampToValueAtTime(0, target);
      }
    }
  }
  setFrequency(value) { this.frequency = Number(value); if (this.osc) this.osc.frequency.value = this.frequency; }
  setWaveform(value) { this.waveform = ['sine', 'triangle', 'square'].includes(value) ? value : 'sine'; if (this.osc) this.osc.type = this.waveform; }
}
