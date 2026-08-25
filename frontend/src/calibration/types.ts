export type State =
  | 'IDLE'
  | 'CONNECTION_CHECK'
  | 'READY'
  | 'ACCLIMATION'
  | 'ACCLIMATION_COMPLETE'
  | 'BLOCK_READY'
  | 'BLOCK_RECORDING'
  | 'SELF_REPORT'
  | 'PROCESSING'
  | 'COMPLETE'
  | 'ERROR';

export type Condition = 'focused_meditation' | 'free_thought';

export interface WavePoint {
  sample_index: number;
  af7: number;
  af8: number;
}

export interface BlockTask {
  task_id: string;
  sequence_number: number;
  condition: Condition;
  condition_label: string;
  condition_block_number: number;
  is_redo: boolean;
  redo_of_block_id: string | null;
  redo_reason: string[] | null;
}

export interface SubjectiveValidity {
  status: 'pass' | 'borderline' | 'invalid';
  reasons: string[];
}

export interface EEGQuality {
  status: 'pass' | 'invalid';
  reasons: string[];
  expected_epochs: number;
  total_epochs: number;
  valid_epochs: number;
  invalid_epochs: number;
  blink_epochs: number;
  packet_completeness: number;
  rejection_counts: Record<string, number>;
  channel_contributions: Record<string, number>;
  epoch_tbrs: (number | null)[];
}

export interface CalibrationBlock extends BlockTask {
  block_id: string;
  actual_sequence_number: number;
  duration_seconds: number | null;
  blink_event_start_count: number;
  blink_event_count: number | null;
  completed_automatically: boolean | null;
  self_report: {
    mind_wandering: number | null;
    drowsiness: number | null;
    investigator_notes: string;
    unable_to_judge: boolean;
  } | null;
  subjective_validity: SubjectiveValidity | null;
  subjective_ideal_distance: number | null;
  eeg_quality: EEGQuality | null;
  eligible_for_anchor?: boolean;
  included_in_anchor: boolean;
}

export interface ConditionEvaluation {
  status: 'pass' | 'insufficient';
  issues: string[];
  selected_block_ids: string[];
  eligible_block_count: number;
  selected_block_count: number;
  total_epochs: number;
  valid_epochs: number;
  invalid_epochs: number;
  blink_epochs: number;
  epoch_tbrs: number[];
  rejection_counts: Record<string, number>;
  channel_contributions: Record<string, number>;
}

export interface Status {
  state: State;
  session: {
    participant_id: string;
    session_id: string;
    calibration_order: 'A' | 'B';
  } | null;
  local_ipv4: string;
  osc_port: number;
  connection: {
    connected: boolean;
    total_eeg_samples: number;
    estimated_sample_rate_hz: number;
    last_packet_age_seconds: number | null;
    headband_on: boolean | null;
    hsi: Record<string, number | null>;
    accelerometer: (number | null)[];
    gyroscope: (number | null)[];
    malformed_messages: number;
    packet_completeness: number;
    low_rate_warning: boolean;
    real_data_seconds: number;
    blink_events_total: number;
    blink_events_session: number;
    last_blink_age_seconds: number | null;
    blink_events_current_or_last_recording: number | null;
    blink_events_current_or_last_label: string | null;
  };
  waveform: WavePoint[];
  markers: { event: string; session_elapsed_seconds: number }[];
  timing: {
    acclimation_duration_seconds: number;
    block_duration_seconds: number;
    active_elapsed_seconds: number;
    active_remaining_seconds: number;
    total_recorded_seconds: number;
  };
  protocol: {
    calibration_order: 'A' | 'B' | null;
    original_schedule: BlockTask[];
    pending_tasks: BlockTask[];
    next_block: BlockTask | null;
    current_block: CalibrationBlock | null;
    completed_blocks: CalibrationBlock[];
    acclimation_attempts: Array<{
      attempt: number;
      blink_event_start_count: number;
      blink_event_count: number | null;
      completed_automatically: boolean;
      accepted: boolean | null;
      review_reason: string | null;
    }>;
    current_acclimation: {
      attempt: number;
      blink_event_start_count: number;
      blink_event_count: number | null;
    } | null;
    redos_planned: boolean;
    collection_decision: string;
  };
  processing_stage?: string;
}

export interface Profile {
  participant_id: string;
  session_id: string;
  sampling_rate_hz: number;
  feature_version: string;
  calibration_order: 'A' | 'B';
  focused_meditation_anchor: number | null;
  free_thought_anchor: number | null;
  difference: number | null;
  direction: 'free_thought_higher' | 'focused_higher' | 'no_difference' | null;
  pooled_mad: number | null;
  separation_score: number | null;
  separation_assessment: {
    status: 'pilot_threshold_not_configured';
    minimum_absolute_difference: number | null;
    minimum_separation_score: number | null;
    require_free_thought_higher: boolean | null;
  };
  collection_decision: 'ready_to_continue' | 'insufficient_after_redo';
  ready_to_continue: boolean;
  mapping_status: 'provisional' | 'unavailable';
  mapping_available: boolean;
  mapping_explanation: string;
  quality_status: 'valid_collection' | 'insufficient_quality';
  quality_issues: string[];
  selected_block_ids: string[];
  blocks: CalibrationBlock[];
  acclimation_attempts: Status['protocol']['acclimation_attempts'];
  quality: {
    status: string;
    collection_decision: string;
    quality_issues: string[];
    packet_completeness: number;
    valid_frontal_fraction: number;
    researcher_quality_override: boolean;
    peak_to_peak_threshold_uv: number;
    block_policy: {
      duration_seconds: number;
      discarded_initial_seconds: number;
      expected_epochs: number;
      minimum_valid_epochs: number;
    };
    condition_policy: {
      minimum_valid_epochs: number;
      maximum_blink_epochs: number | null;
      blink_handling: 'record_only';
      block_selection_priority: string[];
      anchor_aggregation: 'pooled_valid_epoch_median';
      maximum_redos: number;
    };
    condition_summary: Record<Condition, ConditionEvaluation>;
  };
}
