import { assembleCandidates } from "@/engine/catalog";
import { abilityFitFacts } from "@/engine/ability";
import {
  compareJourneyFinalists,
  materializeTeamResult,
} from "@/engine/generate";
import { itemFitFactsForBuild } from "@/engine/item";
import { movePackageQualityForBuild } from "@/engine/move";
import { weatherPlanForTeam } from "@/engine/weather";
import type {
  AlternativeKind,
  GeneratorRequest,
  GeneratedTeamResult,
  MovePackageCapabilities,
  NormalizedCatalog,
  PokemonRecord,
  TeamAlternative,
  BattleMechanicsContext,
  TeamMember,
  TeamResult,
} from "@/lib/types";

function legalReplacementTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
) {
  if (new Set(team.map((pokemon) => pokemon.id)).size !== 6) return false;
  if (team.filter((pokemon) => pokemon.starter).length !== 1) return false;
  const specials = team.filter(
    (pokemon) => pokemon.specialClasses.length > 0,
  ).length;
  if ((!request.allowSpecial && specials > 0) || specials > 1) return false;
  if (
    request.requireMega &&
    !team.some((pokemon) => pokemon.megaFormIds.length > 0)
  ) {
    return false;
  }
  return true;
}

function roleDistance(left: PokemonRecord, right: PokemonRecord) {
  const leftRoles = new Set(left.roles);
  const union = new Set([...left.roles, ...right.roles]);
  const shared = right.roles.filter((role) => leftRoles.has(role)).length;
  return union.size === 0 ? 0 : 1 - shared / union.size;
}

function replacementResult(
  team: PokemonRecord[],
  slot: number,
  replacement: PokemonRecord,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  const roster = team.map((pokemon, index) =>
    index === slot ? replacement : pokemon,
  );
  const result = materializeTeamResult(roster, request, catalog);
  return {
    replacement: result.members[slot],
    result,
  };
}

function difference<T>(left: T[], right: T[]) {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function changedFacts(
  current: string[],
  next: string[],
  empty: string,
) {
  const gained = difference(next, current);
  const lost = difference(current, next);
  const parts = [];
  if (gained.length > 0) parts.push(`gains ${gained.join(", ")}`);
  if (lost.length > 0) parts.push(`loses ${lost.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : empty;
}

function abilityTradeoff(
  current: TeamMember,
  next: TeamMember,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  currentContext: BattleMechanicsContext,
  nextContext: BattleMechanicsContext,
) {
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const facts = (member: TeamMember, context: BattleMechanicsContext) =>
    abilityFitFacts(abilityById.get(member.build.abilityId), request, context).join(
      ", ",
    ) || "no supported sourced effect";
  if (current.build.abilityId === next.build.abilityId) {
    return `Ability fit: preserves ${next.build.ability} (${facts(next, nextContext)}).`;
  }
  return `Ability fit: loses ${current.build.ability} (${facts(current, currentContext)}) and gains ${next.build.ability} (${facts(next, nextContext)}).`;
}

function itemTradeoff(
  current: TeamMember,
  next: TeamMember,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const facts = (member: TeamMember) => {
    const supported = itemFitFactsForBuild(
      member,
      itemById.get(member.build.heldItemId),
      request,
      catalog,
    );
    return supported.length > 0
      ? supported.join(", ")
      : "no supported sourced interaction";
  };
  if (current.build.heldItemId === next.build.heldItemId) {
    return `Held-item fit: preserves ${next.build.heldItem} (${facts(next)}).`;
  }
  return `Held-item fit: loses ${current.build.heldItem} (${facts(current)}) and gains ${next.build.heldItem} (${facts(next)}).`;
}

const capabilityLabels: Record<keyof MovePackageCapabilities, string> = {
  stab: "STAB pressure",
  priority: "priority",
  recovery: "recovery",
  status: "status pressure",
  setup: "setup payoff",
  pivoting: "pivoting",
  hazards: "hazards",
  removal: "hazard removal",
  screens: "screens",
  weather: "weather support",
};

function moveTradeoff(
  current: TeamMember,
  next: TeamMember,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  const currentQuality = movePackageQualityForBuild(current, catalog, request);
  const nextQuality = movePackageQualityForBuild(next, catalog, request);
  const keys = Object.keys(capabilityLabels) as Array<keyof MovePackageCapabilities>;
  const currentCapabilities = keys
    .filter((key) => currentQuality.capabilities[key])
    .map((key) => capabilityLabels[key]);
  const nextCapabilities = keys
    .filter((key) => nextQuality.capabilities[key])
    .map((key) => capabilityLabels[key]);
  const qualityDirection =
    nextQuality.score > currentQuality.score
      ? "overall move quality improves"
      : nextQuality.score < currentQuality.score
        ? "overall move quality declines"
        : "overall move quality remains comparable";
  return `Move package: ${changedFacts(currentCapabilities, nextCapabilities, "preserves its supported capabilities")}; ${qualityDirection}.`;
}

function jobsTradeoff(
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
) {
  const currentJobs = current.battleQuality.team.coveredJobs;
  const nextJobs = next.battleQuality.team.coveredJobs;
  const gained = difference(nextJobs, currentJobs);
  const lost = difference(currentJobs, nextJobs);
  if (gained.length > 0) {
    return `Team jobs gain ${gained.join(", ")}${lost.length > 0 ? ` and lose ${lost.join(", ")}` : ""}.`;
  }
  if (lost.length > 0) return `Team jobs lose ${lost.join(", ")}.`;
  return `Team jobs preserve the same coverage; important gaps remain ${next.battleQuality.team.importantGaps.join(", ") || "none"}.`;
}

function synergyTradeoff(
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
) {
  const currentKinds = [
    ...new Set(current.battleQuality.synergy.interactions.map(({ kind }) => kind)),
  ];
  const nextKinds = [
    ...new Set(next.battleQuality.synergy.interactions.map(({ kind }) => kind)),
  ];
  return `Team synergy: ${changedFacts(currentKinds, nextKinds, `preserves ${nextKinds.join(", ") || "no supported cross-member interaction"}`)}.`;
}

function memberName(result: GeneratedTeamResult, id: string) {
  return result.members.find((member) => member.id === id)?.name ?? id;
}

function speedSources(result: GeneratedTeamResult) {
  const speed = result.battleQuality.plan.speed;
  return [
    ...speed.naturalSpeedMembers.map(
      (id) => `${memberName(result, id)} (natural speed)`,
    ),
    ...speed.priorityMembers.map(
      (id) => `${memberName(result, id)} (priority)`,
    ),
    ...speed.setupMembers.map(
      (id) => `${memberName(result, id)} (speed setup)`,
    ),
    ...speed.itemMembers.map(
      (id) => `${memberName(result, id)} (speed item)`,
    ),
  ];
}

function resilienceTradeoff(
  label: "physical" | "special",
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
) {
  const currentPlan =
    label === "physical"
      ? current.battleQuality.plan.physicalResilience
      : current.battleQuality.plan.specialResilience;
  const nextPlan =
    label === "physical"
      ? next.battleQuality.plan.physicalResilience
      : next.battleQuality.plan.specialResilience;
  const currentSources = [
    ...currentPlan.recoverySources.map(
      (id) => `${memberName(current, id)} recovery`,
    ),
    ...currentPlan.immunitySources.map(
      (id) => `${memberName(current, id)} immunity`,
    ),
  ];
  const nextSources = [
    ...nextPlan.recoverySources.map((id) => `${memberName(next, id)} recovery`),
    ...nextPlan.immunitySources.map((id) => `${memberName(next, id)} immunity`),
  ];
  const direction =
    nextPlan.score > currentPlan.score
      ? "improves"
      : nextPlan.score < currentPlan.score
        ? "weakens"
        : "remains comparable";
  return `${label} resilience ${direction}; ${changedFacts(currentSources, nextSources, "recovery and immunity sources are preserved")}`;
}

function planTradeoff(
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
) {
  const speed = changedFacts(
    speedSources(current),
    speedSources(next),
    next.battleQuality.plan.speed.missing
      ? "still lacks a supported control source"
      : "preserves its supported control sources",
  );
  return `Speed plan: ${speed}; ${resilienceTradeoff("physical", current, next)}; ${resilienceTradeoff("special", current, next)}.`;
}

function acquisitionTradeoff(
  currentMember: TeamMember,
  nextMember: TeamMember,
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
) {
  const currentCurve = current.battleQuality.acquisitionCurve;
  const nextCurve = next.battleQuality.acquisitionCurve;
  const milestoneChanges = nextCurve.milestones
    .slice(0, 2)
    .flatMap((milestone, index) => {
      const previous = currentCurve.milestones[index];
      if (
        previous.acquiredCount === milestone.acquiredCount &&
        previous.coveredJobs.join("|") === milestone.coveredJobs.join("|")
      ) {
        return [];
      }
      return [
        `${milestone.stage} changes from ${previous.acquiredCount} member(s) covering ${previous.coveredJobs.join(", ") || "no supported jobs"} to ${milestone.acquiredCount} covering ${milestone.coveredJobs.join(", ") || "no supported jobs"}`,
      ];
    });
  const lateChange =
    currentCurve.lateMembers.length === nextCurve.lateMembers.length
      ? []
      : [
          `Late additions change from ${currentCurve.lateMembers.length} to ${nextCurve.lateMembers.length}${nextCurve.lateClusterPenalty > 0 ? ", leaving a late-game cluster" : ", without an excessive late-game cluster"}`,
        ];
  const nextJobs = nextMember.jobs ?? [];
  const lateValue =
    nextMember.availability.stage === "Late" && nextJobs.length > 0
      ? [`${nextMember.name} retains final-team value through ${nextJobs.join(", ")}`]
      : [];
  const rosterEffects = [...milestoneChanges, ...lateChange, ...lateValue];
  return `Acquisition curve: loses ${currentMember.name} (${currentMember.availability.stage}, ${currentMember.availability.difficulty}) and gains ${nextMember.name} (${nextMember.availability.stage}, ${nextMember.availability.difficulty})${rosterEffects.length > 0 ? `; ${rosterEffects.join("; ")}` : "; full-roster Early, Mid, and Late functionality is preserved"}.`;
}

function compareReplacementResults(
  left: ReturnType<typeof replacementResult>,
  right: ReturnType<typeof replacementResult>,
) {
  return compareJourneyFinalists(
    { roster: left.result.members, score: left.result.score },
    { roster: right.result.members, score: right.result.score },
  );
}

function asAlternative(
  kind: AlternativeKind,
  label: string,
  introduction: string,
  candidate: ReturnType<typeof replacementResult>,
  original: TeamMember,
  evaluatedCurrent: GeneratedTeamResult,
  snapshotCurrent: TeamResult,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): TeamAlternative {
  const { replacement, result } = candidate;
  const currentWeather = weatherPlanForTeam(
    evaluatedCurrent.members,
    request,
    catalog,
  );
  const nextWeather = weatherPlanForTeam(result.members, request, catalog);
  return {
    kind,
    label,
    replacement,
    result,
    scoreDelta: result.score.total - snapshotCurrent.score.total,
    tradeoff: [
      introduction,
      abilityTradeoff(
        original,
        replacement,
        request,
        catalog,
        currentWeather.context,
        nextWeather.context,
      ),
      itemTradeoff(original, replacement, request, catalog),
      moveTradeoff(original, replacement, request, catalog),
      jobsTradeoff(evaluatedCurrent, result),
      synergyTradeoff(evaluatedCurrent, result),
      planTradeoff(evaluatedCurrent, result),
      acquisitionTradeoff(original, replacement, evaluatedCurrent, result),
    ].join(" "),
  };
}

export function generateAlternatives(
  slot: number,
  request: GeneratorRequest,
  current: TeamResult,
  catalog: NormalizedCatalog,
): TeamAlternative[] {
  if (slot < 0 || slot > 5) throw new Error("Alternative slot must be 0-5.");
  const candidates = assembleCandidates(
    catalog,
    request.style,
    request.weather,
  );
  const team = current.members.map((member) => {
    const {
      slot: memberSlot,
      selectedRole,
      mega,
      gamePlan,
      jobs,
      jobExplanation,
      ...pokemon
    } = member;
    void memberSlot;
    void selectedRole;
    void mega;
    void gamePlan;
    void jobs;
    void jobExplanation;
    return pokemon;
  });
  const evaluatedCurrent = materializeTeamResult(team, request, catalog);
  const original = evaluatedCurrent.members[slot];
  const replacements = candidates
    .filter((candidate) => candidate.id !== original.id)
    .filter((candidate) => {
      const roster = team.map((member, index) =>
        index === slot ? candidate : member,
      );
      return legalReplacementTeam(roster, request);
    })
    .map((candidate) =>
      replacementResult(team, slot, candidate, request, catalog),
    );
  if (replacements.length === 0) return [];

  const best = [...replacements].sort(compareReplacementResults)[0];
  const easiest =
    [...replacements]
      .filter((candidate) => candidate.replacement.id !== best.replacement.id)
      .sort(
        (left, right) =>
          right.replacement.availability.score -
            left.replacement.availability.score ||
          compareReplacementResults(left, right),
      )[0] ?? best;
  const different =
    [...replacements]
      .filter(
        (candidate) =>
          candidate.replacement.id !== best.replacement.id &&
          candidate.replacement.id !== easiest.replacement.id,
      )
      .sort(
        (left, right) =>
          roleDistance(original, right.replacement) -
            roleDistance(original, left.replacement) ||
          compareReplacementResults(left, right),
      )[0] ?? best;

  return [
    asAlternative(
      "best",
      "Best team fit",
      "Highest complete-team quality while preserving every invariant.",
      best,
      original,
      evaluatedCurrent,
      current,
      request,
      catalog,
    ),
    asAlternative(
      "easiest",
      "Easiest to obtain",
      "Prioritizes sourced acquisition timing, then complete-team quality.",
      easiest,
      original,
      evaluatedCurrent,
      current,
      request,
      catalog,
    ),
    asAlternative(
      "different",
      "Different tactical style",
      "Prioritizes a different supported role while preserving team constraints.",
      different,
      original,
      evaluatedCurrent,
      current,
      request,
      catalog,
    ),
  ];
}
