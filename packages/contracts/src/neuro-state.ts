export type SessionTimestampMs = number;

export type NeuroTrend = 'increasing' | 'decreasing' | 'stable';

export interface NeuroMetric {
  value: number;
  trend: NeuroTrend;
}

export interface NeuroState {
  timestampMs: SessionTimestampMs;
  arousal: NeuroMetric;
  confidence?: number;
  /** Optional Module 01 detail. `arousal` remains for protocol 1.0 compatibility. */
  attention?: {
    currentLogTbr: number | null;
    /** Unbounded position on the empirical MW-reference (0) to focus-reference (1) axis. */
    relativePosition?: number | null;
    referenceGap?: number;
    deltaFromFocus?: number | null;
    deltaFromMindWandering?: number | null;
    coverage?: string;
    trajectory?: string;
    relativePositionSlope?: number | null;
    measurementConfidence?: 'high' | 'medium' | 'low';
    calibrationQuality?: 'high' | 'medium' | 'low' | 'unusable';
    signalQuality?: 'good' | 'fair' | 'poor' | 'unavailable';
    stateEstimationVersion?: string;
    /** Visualization only; not a focus probability or percentage. */
    focusPosition: number | null;
    /** Visualization only; not a mind-wandering probability or percentage. */
    mindWanderingPosition: number | null;
    label:
      'focus-leaning' | 'intermediate' | 'mind-wandering-leaning' | 'uncertain';
    trend:
      | 'toward-focus'
      | 'toward-mind-wandering'
      | 'stable'
      | 'insufficient-history';
    variabilityMad: number | null;
    phase: 'opening' | 'adaptive' | 'closing';
    validEpochCount: number;
  };
}
