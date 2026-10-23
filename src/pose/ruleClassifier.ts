import { analyzeBody } from "./bodyFrame";
import { checkCondition } from "./poseConditions";
import { POSE_LIBRARY_CONFIG } from "./poseConfig";
import type { ArmMetrics, ArmRole, BodyFrame, ConditionResult, PoseClassifier, PoseEvaluation, PoseFrame, Side } from "./poseTypes";

/**
 * Declarative pose classifier for the expanded library. Same building blocks
 * and semantics as the hand-written classifiers (analyzeBody metrics,
 * checkCondition with release slack, both role assignments tried so the
 * mirrored pose counts, best assignment reported for coaching).
 */
type Slack = "angle" | "distance" | "level";

interface RuleBase {
  id: string;
  label: string;
  min?: number;
  max?: number;
  slack: Slack;
  unit?: string;
  tooLow?: string;
  tooHigh?: string;
}

export interface ArmRule extends RuleBase {
  value: (arm: ArmMetrics) => number;
}

export interface BodyRule extends RuleBase {
  /** Role the condition is attributed to (for the debug UI). */
  role: ArmRole;
  /** null = can't be measured this frame (e.g. legs not visible): the rule is skipped, never failed. */
  value: (body: BodyFrame, sides: { a: Side; b: Side }) => number | null;
}

export interface RulePoseSpec {
  id: string;
  name: string;
  description: string;
  /** Role of arm A and arm B. Equal roles = symmetric pose (both arms follow the same rules). */
  roles: [ArmRole, ArmRole];
  arms: Partial<Record<ArmRole, ArmRule[]>>;
  body?: BodyRule[];
}

const OTHER: Record<Side, Side> = { left: "right", right: "left" };

interface Assignment {
  a: Side;
  b: Side;
  conditions: ConditionResult[];
  blocker: string | null;
  passCount: number;
  matched: boolean;
  loose: boolean;
}

export function createRuleClassifier(spec: RulePoseSpec): PoseClassifier {
  const [roleA, roleB] = spec.roles;
  const symmetric = roleA === roleB;
  const S = POSE_LIBRARY_CONFIG.releaseSlack;

  const check = (rule: RuleBase, role: ArmRole, id: string, raw: number) => {
    // A non-finite measurement (degenerate landmarks) must never count as a pass.
    const value = Number.isFinite(raw) ? raw : rule.min !== undefined ? -Infinity : Infinity;
    return checkCondition({
      id,
      role,
      label: rule.label,
      value,
      min: rule.min,
      max: rule.max,
      slack: S[rule.slack],
      unit: rule.unit ?? (rule.slack === "angle" ? "°" : ""),
      tooLow: rule.tooLow,
      tooHigh: rule.tooHigh,
    });
  };

  const assess = (a: Side, b: Side, body: BodyFrame): Assignment => {
    const armA = body.arms[a];
    const armB = body.arms[b];
    const base = { a, b, conditions: [], passCount: -1, matched: false, loose: false };
    if (!armA || !armB || !armA.reliable || !armB.reliable) {
      const cropped = (armA?.cropped ?? true) || (armB?.cropped ?? true);
      return { ...base, blocker: cropped ? "Step back so both arms are in view" : "Keep both arms visible" };
    }
    const conditions: ConditionResult[] = [];
    const armRules = (side: Side, arm: ArmMetrics, role: ArmRole) => {
      for (const r of spec.arms[role] ?? []) {
        conditions.push(check(r, role, symmetric ? `${side[0]!.toUpperCase()}.${r.id}` : `${role}.${r.id}`, r.value(arm)));
      }
    };
    armRules(a, armA, roleA);
    armRules(b, armB, roleB);
    for (const r of spec.body ?? []) {
      const v = r.value(body, { a, b });
      if (v !== null && Number.isFinite(v)) conditions.push(check(r, r.role, `body.${r.id}`, v));
    }
    const passCount = conditions.filter((c) => c.pass).length;
    return {
      ...base,
      conditions,
      blocker: null,
      passCount,
      matched: passCount === conditions.length,
      loose: conditions.every((c) => c.loosePass),
    };
  };

  const classifier: PoseClassifier = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    primaryRole: roleA,
    evaluate(frame: PoseFrame): PoseEvaluation {
      const analysis = analyzeBody(frame);
      const emptyRoles = { [roleA]: null, [roleB]: null } as Partial<Record<ArmRole, Side | null>>;
      if (!analysis.ok) {
        return {
          poseId: spec.id,
          matched: false,
          stillInPose: false,
          feedback: analysis.feedback,
          roles: emptyRoles,
          conditions: [],
          body: null,
          zones: [],
        };
      }
      const body = analysis.body;
      const options: Assignment[] = symmetric
        ? [assess("left", "right", body)]
        : (["left", "right"] as const).map((a) => assess(a, OTHER[a], body));
      const best = options.find((o) => o.matched) ?? [...options].sort((x, y) => y.passCount - x.passCount)[0]!;

      let feedback: string;
      if (best.blocker) feedback = best.blocker;
      else if (best.matched) feedback = "HOLD...";
      else feedback = best.conditions.find((c) => !c.pass)?.message ?? "Match the pose";

      return {
        poseId: spec.id,
        matched: best.matched,
        stillInPose: options.some((o) => o.loose),
        feedback,
        roles: symmetric ? { [roleA]: best.a } : { [roleA]: best.a, [roleB]: best.b },
        conditions: best.conditions,
        body,
        zones: [],
      };
    },
  };
  return classifier;
}
