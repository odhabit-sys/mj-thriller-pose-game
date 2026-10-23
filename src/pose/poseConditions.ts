import type { ArmRole, ConditionResult } from "./poseTypes";

export interface ConditionSpec {
  id: string;
  role: ArmRole;
  label: string;
  value: number;
  min?: number;
  max?: number;
  /** How far past min/max still counts as "roughly in the pose" (release hysteresis). */
  slack: number;
  unit?: string;
  /** Coaching when value < min. */
  tooLow?: string;
  /** Coaching when value > max. */
  tooHigh?: string;
}

/** One range check with strict + loose (hysteresis) results and a coaching message. */
export function checkCondition(spec: ConditionSpec): ConditionResult {
  const { value, min, max, slack } = spec;
  const lowFail = min !== undefined && value < min;
  const highFail = max !== undefined && value > max;
  const loosePass = (min === undefined || value >= min - slack) && (max === undefined || value <= max + slack);
  return {
    id: spec.id,
    role: spec.role,
    label: spec.label,
    value,
    min,
    max,
    unit: spec.unit ?? "",
    pass: !lowFail && !highFail,
    loosePass,
    message: lowFail ? (spec.tooLow ?? spec.label) : highFail ? (spec.tooHigh ?? spec.label) : null,
  };
}
