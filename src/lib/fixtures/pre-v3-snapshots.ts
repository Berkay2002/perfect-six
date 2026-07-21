import type {
  GeneratorRequest,
  SavedTeam,
  SharePayload,
  TeamMember,
  TeamResult,
} from "@/lib/types";

function legacyMember(slot: number): TeamMember {
  const name = `Legacy Member ${slot + 1}`;
  return {
    id: `legacy-member-${slot + 1}`,
    dexNumber: slot + 1,
    name,
    baseSpecies: name,
    types: ["Normal"],
    stats: {
      hp: 80,
      attack: 80,
      defense: 80,
      specialAttack: 80,
      specialDefense: 80,
      speed: 80,
    },
    abilities: ["legacyability"],
    learnset: [],
    evolutions: [],
    preEvolutionId: null,
    finalEvolution: true,
    battleOnly: false,
    formKind: "base",
    starter: slot === 0,
    specialClasses: [],
    megaFormIds: [],
    artwork: "/legacy-art.png",
    spriteFallback: "/legacy-sprite.png",
    labels: [],
    sourcePaths: ["fixture://pre-v3"],
    roles: ["Legacy role"],
    battleScore: 50,
    availability: {
      speciesId: `legacy-member-${slot + 1}`,
      difficulty: "Easy",
      stage: "Early",
      evolutionLine: name,
      guidance: "Preserved from the original snapshot.",
      score: 80,
      evidence: [],
    },
    build: {
      id: `legacy-build-${slot + 1}`,
      speciesId: `legacy-member-${slot + 1}`,
      source: {
        kind: "derived",
        format: "Legacy fixture",
        url: "fixture://pre-v3",
      },
      abilityId: "legacyability",
      ability: "Legacy Ability",
      nature: "Serious",
      heldItemId: "legacyitem",
      heldItem: "Legacy Item",
      evs: {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      },
      moves: [0, 1, 2, 3].map((move) => ({
        id: `legacy-move-${move + 1}`,
        name: `Legacy Move ${move + 1}`,
        type: "Normal",
        category: "Physical" as const,
        power: 50,
        accuracy: 100,
        purpose: "Preserved legacy move.",
      })) as TeamMember["build"]["moves"],
      practicalSubstitute: "No substitution recorded.",
    },
    slot,
    selectedRole: "Legacy role",
    mega: false,
    gamePlan: "Preserved legacy plan.",
  };
}

function payload(engineVersion: 1 | 2): SharePayload {
  const request = {
    schemaVersion: 1,
    dataVersion: "cobbleverse-1.7.41b",
    engineVersion,
    seed: `PRE-V3-${engineVersion}`,
    style: "balanced",
    availability: "journey",
    allowSpecial: false,
    requireMega: false,
    slots: [null, null, null, null, null, null],
  } as unknown as GeneratorRequest;
  const result = {
    members: Array.from({ length: 6 }, (_, slot) =>
      legacyMember(slot),
    ) as TeamResult["members"],
    score: {
      total: 70 + engineVersion,
      journeyScore: 75,
      battleScore: 65,
      roleCoverage: 70,
      defensiveFit: 70,
      offensiveReach: 70,
      journeyFit: 75,
      utility: 65,
    },
    warnings: [],
    provenance: {
      dataVersion: "cobbleverse-1.7.41b",
      engineVersion,
      generatedAt: "2026-01-01T00:00:00.000Z",
      sources: ["fixture://pre-v3"],
      verified: true,
    },
  } as unknown as TeamResult;
  return { schemaVersion: 1, request, result };
}

export const preV3SharePayloads = [payload(1), payload(2)];

export const preV3SavedTeams: SavedTeam[] = preV3SharePayloads.map(
  ({ request, result }, index) => ({
    schemaVersion: 1,
    id: `pre-v3-${index + 1}`,
    name: `Pre-v3 team ${index + 1}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    request,
    result,
  }),
);
