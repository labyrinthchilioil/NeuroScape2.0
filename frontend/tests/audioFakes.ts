export class FakeAudioParam {
  value = 0;
  calls: Array<[string, number, number]> = [];
  cancelScheduledValues(time: number) {
    this.calls.push(['cancel', 0, time]);
    return this as unknown as AudioParam;
  }
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push(['set', value, time]);
    return this as unknown as AudioParam;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push(['ramp', value, time]);
    return this as unknown as AudioParam;
  }
}

export class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(destination: unknown) {
    this.connections.push(destination);
    return destination as AudioNode;
  }
  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}
export class FakeGain extends FakeNode {
  gain = new FakeAudioParam();
}
export class FakePanner extends FakeNode {
  positionX = new FakeAudioParam();
  positionY = new FakeAudioParam();
  positionZ = new FakeAudioParam();
  panningModel: PanningModelType = 'equalpower';
  distanceModel: DistanceModelType = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
}
export class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];
  start(time = 0) {
    this.starts.push(time);
  }
  stop(time = 0) {
    this.stops.push(time);
  }
}
export class FakeAudioContext {
  currentTime = 2;
  state: AudioContextState = 'suspended';
  destination = new FakeNode() as unknown as AudioDestinationNode;
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  sources: FakeSource[] = [];
  closed = false;
  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node as unknown as GainNode;
  }
  createPanner() {
    const node = new FakePanner();
    this.panners.push(node);
    return node as unknown as PannerNode;
  }
  createBufferSource() {
    const node = new FakeSource();
    this.sources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 } as AudioBuffer);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    this.closed = true;
    return Promise.resolve();
  }
}

export class FakeCapturingAudioContext extends FakeAudioContext {
  captureDestination =
    new FakeNode() as unknown as MediaStreamAudioDestinationNode;
  createMediaStreamDestination() {
    return Object.assign(this.captureDestination, {
      stream: {} as MediaStream,
    });
  }
}

export const fakeBuffer = { duration: 1 } as AudioBuffer;
