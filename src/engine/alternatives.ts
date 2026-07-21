import { assembleCandidates } from "@/engine/catalog";
import { materializeTeamResult } from "@/engine/generate";
import { scoreTeam } from "@/engine/score";
import type {
  AlternativeKind,
  GeneratorRequest,
  NormalizedCatalog,
  PokemonRecord,
  TeamAlternative,
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
  return {
    roster,
    replacement,
    score: scoreTeam(roster, request, catalog),
  };
}

function asAlternative(
  kind: AlternativeKind,
  label: string,
  tradeoff: string,
  candidate: ReturnType<typeof replacementResult>,
  current: TeamResult,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): TeamAlternative {
  const result = materializeTeamResult(
    candidate.roster,
    request,
    catalog,
  );
  const replacement = result.members.find(
    (member) => member.id === candidate.replacement.id,
  )!;
  const currentCapabilities = current.battleQuality?.move?.capabilities;
  const nextCapabilities = result.battleQuality.move.capabilities;
  const capabilityLabels = {
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
  } as const;
  const changed = currentCapabilities
    ? (Object.keys(capabilityLabels) as Array<keyof typeof capabilityLabels>)
        .filter((capability) => currentCapabilities[capability] !== nextCapabilities[capability])
        .map(
          (capability) =>
            `${nextCapabilities[capability] ? "gains" : "loses"} ${capabilityLabels[capability]}`,
        )
    : [];
  const moveTradeoff = changed.length > 0
    ? ` Move package ${changed.join(" and ")}.`
    : ` Move-package quality changes by ${result.battleQuality.move.contribution - (current.battleQuality?.move?.contribution ?? 0)} point(s) without changing its exposed jobs.`;
  const currentJobs = current.battleQuality?.team?.coveredJobs;
  const nextJobs = result.battleQuality.team.coveredJobs;
  const gainedJobs = currentJobs
    ? nextJobs.filter((job) => !currentJobs.includes(job))
    : nextJobs;
  const lostJobs = currentJobs
    ? currentJobs.filter((job) => !nextJobs.includes(job))
    : [];
  const teamTradeoff = !currentJobs
    ? ` Team jobs gain a current-engine explanation covering ${nextJobs.join(", ") || "no supported jobs"}.`
    : gainedJobs.length > 0
      ? ` Team jobs gain ${gainedJobs.join(", ")}${lostJobs.length > 0 ? ` and lose ${lostJobs.join(", ")}` : ""}.`
      : lostJobs.length > 0
        ? ` Team jobs lose ${lostJobs.join(", ")}.`
        : ` Team jobs preserve the same coverage; important gaps remain ${result.battleQuality.team.importantGaps.join(", ") || "none"}.`;
  const currentPlan = current.battleQuality?.plan;
  const nextPlan = result.battleQuality.plan;
  const planTradeoff = currentPlan
    ? ` Speed plan changes by ${nextPlan.speed.score - currentPlan.speed.score} point(s); physical resilience changes by ${nextPlan.physicalResilience.score - currentPlan.physicalResilience.score} and special resilience by ${nextPlan.specialResilience.score - currentPlan.specialResilience.score}.`
    : ` Speed plan and physical resilience gain current-engine explanations at ${nextPlan.speed.score}/100 and ${nextPlan.physicalResilience.score}/100; special resilience is ${nextPlan.specialResilience.score}/100.`;
  return {
    kind,
    label,
    replacement,
    result,
    scoreDelta: result.score.total - current.score.total,
    tradeoff: `${tradeoff}${moveTradeoff}${teamTradeoff}${planTradeoff}`,
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
      slot,
      selectedRole,
      mega,
      gamePlan,
      jobs,
      jobExplanation,
      ...pokemon
    } = member;
    void slot;
    void selectedRole;
    void mega;
    void gamePlan;
    void jobs;
    void jobExplanation;
    return pokemon;
  });
  const original = team[slot];
  const replacements = candidates
    .filter((candidate) => candidate.id !== original.id)
    .map((candidate) =>
      replacementResult(team, slot, candidate, request, catalog),
    )
    .filter((candidate) => legalReplacementTeam(candidate.roster, request));
  if (replacements.length === 0) return [];

  const best = [...replacements].sort(
    (left, right) =>
      right.score.total - left.score.total ||
      left.replacement.id.localeCompare(right.replacement.id),
  )[0];
  const easiest =
    [...replacements]
      .filter((candidate) => candidate.replacement.id !== best.replacement.id)
      .sort(
        (left, right) =>
          right.replacement.availability.score -
            left.replacement.availability.score ||
          right.score.total - left.score.total ||
          left.replacement.id.localeCompare(right.replacement.id),
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
          right.score.total - left.score.total ||
          left.replacement.id.localeCompare(right.replacement.id),
      )[0] ?? best;

  return [
    asAlternative(
      "best",
      "Best team fit",
      "Highest full-team score while preserving every invariant.",
      best,
      current,
      request,
      catalog,
    ),
    asAlternative(
      "easiest",
      "Easiest to obtain",
      "Prioritizes sourced acquisition score, then full-team quality.",
      easiest,
      current,
      request,
      catalog,
    ),
    asAlternative(
      "different",
      "Different tactical style",
      "Maximizes role difference while keeping team constraints legal.",
      different,
      current,
      request,
      catalog,
    ),
  ];
}
