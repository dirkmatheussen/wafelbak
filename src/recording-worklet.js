class ElandRecorder extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.samples = new Int16Array(sampleRate * processorOptions.seconds);
    this.length = 0;
    this.finished = false;
    this.port.onmessage = () => this.finish();
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const samples = this.samples.slice(0, this.length);
    this.port.postMessage(samples, [samples.buffer]);
  }

  process(inputs) {
    if (this.finished) {
      return false;
    }

    const channel = inputs[0][0];
    if (!channel) {
      return true;
    }

    for (const sample of channel) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.samples[this.length++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      if (this.length === this.samples.length) {
        this.finish();
        return false;
      }
    }
    return true;
  }
}

registerProcessor("eland-recorder", ElandRecorder);
