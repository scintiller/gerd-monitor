export type RefluxType = 'acid' | 'weakly_acidic' | 'non_acid_bolus' | 'weakly_alkaline';
export type Severity = 'mild' | 'moderate' | 'severe';

export interface RefluxEvent {
  id: number;
  start_s: number;
  end_s: number;
  duration_s: number;
  type: RefluxType;
  ph_nadir: number;
  ph_at_start: number;
  proximal_extent_cm: number;
  proximal_channel: string;
  distal_channels_involved: number;
  severity: Severity;
  severity_score: number;
  is_long: boolean;
  notes: string[];
}

export interface Summary {
  recording_duration_h: number;
  sample_rate_hz: number;
  aet_percent: number;
  aet_threshold_pathological: number;
  aet_threshold_normal: number;
  diagnosis: string;
  diagnosis_level: 'conclusive' | 'normal' | 'inconclusive';
  total_reflux_episodes: number;
  acid_episodes: number;
  weakly_acidic_episodes: number;
  non_acid_episodes: number;
  longest_acid_episode_s: number;
  long_episodes_over_5min: number;
  mnbi_per_channel: Record<string, number>;
  mnbi_distal_mean: number;
  mnbi_threshold_abnormal: number;
  supportive_evidence: string[];
  channel_positions_cm: Record<string, number>;
}

export interface Overview {
  sample_rate_hz: number;
  n_samples: number;
  t: number[];
  pH: number[];
  pH_min: number[];
  Imp11: number[];
  Imp12: number[];
  Imp13: number[];
  Imp14: number[];
  Imp16: number[];
  Imp17: number[];
}

export interface Zoom {
  event_id: number;
  start_s: number;
  end_s: number;
  sample_rate_hz: number;
  t: number[];
  pH: number[];
  Imp11: number[];
  Imp12: number[];
  Imp13: number[];
  Imp14: number[];
  Imp16: number[];
  Imp17: number[];
}

export type ViewMode = 'patient' | 'doctor';
