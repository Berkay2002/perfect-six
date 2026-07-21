import { memberJobExplanation } from "@/engine/team";
import type {
  AcquisitionMilestone,
  GeneratorRequest,
  JourneyAcquisitionQuality,
  MemberJobExplanation,
  NormalizedCatalog,
  PokemonRecord,
  TeamJob,
} from "@/lib/types";

const STAGES = ["Early", "Mid", "Late"] as const;
const stageIndex = new Map(STAGES.map((stage, index) => [stage, index]));
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export type JourneyCurveOptions = {
  evaluatedJobs?: readonly MemberJobExplanation[];
  influence?: number;
};

export function legacyJourneyFitForTeam(team: PokemonRecord[]) {
  return clamp(average(team.map((member) => member.availability.score)));
}

function jobsForMembers(
  members: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  evaluatedJobs?: readonly MemberJobExplanation[],
) {
  if (evaluatedJobs) {
    return new Map(
      evaluatedJobs.map((member) => [member.speciesId, member.jobs]),
    );
  }
  const byMember = new Map(
    members.map((member) => [
      member.id,
      memberJobExplanation(member, request, catalog).jobs,
    ]),
  );
  return byMember;
}

function uniqueJobs(jobSets: Iterable<readonly TeamJob[]>) {
  return [...new Set([...jobSets].flat())];
}

function milestonesFor(
  team: PokemonRecord[],
  jobsByMember: Map<string, TeamJob[]>,
): JourneyAcquisitionQuality["milestones"] {
  let previousJobs: TeamJob[] = [];
  return STAGES.map((stage, index): AcquisitionMilestone => {
    const members = team.filter(
      (member) => (stageIndex.get(member.availability.stage) ?? 2) <= index,
    );
    const coveredJobs = uniqueJobs(
      members.map((member) => jobsByMember.get(member.id) ?? []),
    );
    const milestone = {
      stage,
      acquiredCount: members.length,
      memberIds: members.map((member) => member.id),
      coveredJobs,
      newJobs: coveredJobs.filter((job) => !previousJobs.includes(job)),
    };
    previousJobs = coveredJobs;
    return milestone;
  }) as JourneyAcquisitionQuality["milestones"];
}

function memberNames(team: PokemonRecord[], memberIds: readonly string[]) {
  const names = new Map(team.map((member) => [member.id, member.name]));
  return memberIds.map((id) => names.get(id) ?? id).join(", ") || "none";
}

function lateValueExplanation(
  team: PokemonRecord[],
  jobsByMember: Map<string, TeamJob[]>,
) {
  const accessibleJobs = uniqueJobs(
    team
      .filter((member) => member.availability.stage !== "Late")
      .map((member) => jobsByMember.get(member.id) ?? []),
  );
  const usefulLate = team
    .filter((member) => member.availability.stage === "Late")
    .map((member) => ({
      name: member.name,
      jobs: (jobsByMember.get(member.id) ?? []).filter(
        (job) => !accessibleJobs.includes(job),
      ),
    }))
    .filter((member) => member.jobs.length > 0);
  if (usefulLate.length === 0) {
    return "Late additions do not add a missing supported team job.";
  }
  return `Late additions retain final-team value: ${usefulLate
    .map((member) => `${member.name} adds ${member.jobs.join(", ")}`)
    .join("; ")}.`;
}

export function journeyCurveQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  options: JourneyCurveOptions = {},
): JourneyAcquisitionQuality {
  const influence = options.influence ?? 1;
  const jobsByMember = jobsForMembers(
    team,
    request,
    catalog,
    options.evaluatedJobs,
  );
  const milestones = milestonesFor(team, jobsByMember);
  const averageAvailability = legacyJourneyFitForTeam(team);
  const lateMembers = team
    .filter((member) => member.availability.stage === "Late")
    .map((member) => member.id);

  if (influence === 0) {
    return {
      score: averageAvailability,
      timingPenalty: 0,
      lateClusterPenalty: 0,
      averageAvailability,
      lateMembers,
      milestones,
      explanation:
        "Acquisition-curve adjustments are neutralized for compatibility evaluation.",
    };
  }

  if (request.availability === "unrestricted") {
    return {
      score: 100,
      timingPenalty: 0,
      lateClusterPenalty: 0,
      averageAvailability,
      lateMembers,
      milestones,
      explanation:
        "Unrestricted mode makes no journey timing adjustment. Early, Mid, and Late acquisition are shown for context only.",
    };
  }

  const early = milestones[0];
  const mid = milestones[1];
  // Three distinct jobs early and five by mid are useful milestones for a
  // six-member singles roster. Fixed targets avoid treating a uniquely useful
  // late member as worse merely because it expands the final job vocabulary.
  const earlyFunctionality = clamp((early.coveredJobs.length / 3) * 100);
  const midFunctionality = clamp((mid.coveredJobs.length / 5) * 100);
  const progressiveFunctionality =
    earlyFunctionality * 0.45 + midFunctionality * 0.55;
  const accessProgress =
    (early.acquiredCount / Math.max(1, team.length)) * 40 +
    (mid.acquiredCount / Math.max(1, team.length)) * 60;
  const lateClusterPenalty = Math.max(0, lateMembers.length - 2) * 0.1;
  const timingPenalty = Number(
    ((100 - progressiveFunctionality) * 0.01 + lateClusterPenalty).toFixed(2),
  );
  const activeScore = Number(
    clamp(
      averageAvailability +
        (progressiveFunctionality - 70) * 0.002 +
        (accessProgress - 70) * 0.001 -
        lateClusterPenalty,
    ).toFixed(2),
  );
  const score = Number(
    (averageAvailability + (activeScore - averageAvailability) * influence).toFixed(6),
  );
  const lateValue = lateValueExplanation(team, jobsByMember);

  return {
    score,
    timingPenalty,
    lateClusterPenalty,
    averageAvailability,
    lateMembers,
    milestones,
    explanation: `Early: ${early.acquiredCount} member(s) (${memberNames(team, early.memberIds)}) cover ${early.coveredJobs.join(", ") || "no supported jobs"}. Mid: ${mid.acquiredCount} member(s) cover ${mid.coveredJobs.join(", ") || "no supported jobs"}; new Mid functions are ${mid.newJobs.join(", ") || "none"}. Late: ${lateMembers.length} addition(s) (${memberNames(team, lateMembers)}). ${lateMembers.length > 2 ? `The ${lateMembers.length} Late additions are clustered and receive a soft timing penalty.` : "Late acquisition is not excessively clustered."} ${lateValue}`,
  };
}
