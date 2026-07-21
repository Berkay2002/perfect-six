import { ENGINE_VERSION as CURRENT_ENGINE_VERSION } from "../../data/engine-version.mjs";

export const DATA_VERSION = "cobbleverse-1.7.41b" as const;
export const ENGINE_VERSION = CURRENT_ENGINE_VERSION;
export const SCHEMA_VERSION = 1 as const;

export type TeamStyle =
  | "balanced"
  | "aggressive"
  | "bulky"
  | "weather"
  | "random";

export type Weather = "rain" | "sun" | "sand" | "snow" | "random";
export type AvailabilityMode = "journey" | "unrestricted";
export type Difficulty = "Easy" | "Moderate" | "Hard" | "Late game";
export type SpeciesFormId = string;
export type MoveId = string;
export type AbilityId = string;
export type ItemId = string;
export type MoveCategory = "Physical" | "Special" | "Status";
export type SpecialClass =
  | "legendary"
  | "mythical"
  | "ultra-beast"
  | "paradox";
export type LearnMethod =
  | "level"
  | "egg"
  | "tm"
  | "tutor"
  | "legacy"
  | "special"
  | "other";

export type StatBlock = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

export type EVSpread = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

export type MoveBuild = {
  id: MoveId;
  name: string;
  type: string;
  category: MoveCategory;
  power: number | null;
  accuracy: number | null;
  purpose: string;
};

export type BuildTemplate = {
  id: string;
  speciesId: SpeciesFormId;
  source: {
    kind: "smogon" | "derived";
    format: string;
    url: string;
    setName?: string;
  };
  abilityId: AbilityId;
  ability: string;
  nature: string;
  heldItemId: ItemId;
  heldItem: string;
  evs: EVSpread;
  moves: [MoveBuild, MoveBuild, MoveBuild, MoveBuild];
  practicalSubstitute: string;
};

export type AvailabilityRecord = {
  speciesId: SpeciesFormId;
  difficulty: Difficulty;
  stage: "Early" | "Mid" | "Late";
  evolutionLine: string;
  guidance: string;
  score: number;
  evidence: Array<{
    kind: "spawn" | "evolution" | "summon" | "unknown";
    sourcePath: string;
    summary: string;
  }>;
};

export type LearnsetEntry = {
  moveId: MoveId;
  methods: LearnMethod[];
  raw: string[];
};

export type EvolutionRecord = {
  targetId: SpeciesFormId;
  variant: string;
  minimumLevel?: number;
  requiredItemId?: ItemId;
  rawRequirements: unknown[];
};

export type SpeciesRecord = {
  id: SpeciesFormId;
  dexNumber: number;
  name: string;
  baseSpecies: string;
  types: [string] | [string, string];
  stats: StatBlock;
  abilities: AbilityId[];
  learnset: LearnsetEntry[];
  evolutions: EvolutionRecord[];
  preEvolutionId: SpeciesFormId | null;
  finalEvolution: boolean;
  battleOnly: boolean;
  formKind: "base" | "regional" | "alternate" | "battle";
  starter: boolean;
  specialClasses: SpecialClass[];
  megaFormIds: SpeciesFormId[];
  artwork: string;
  spriteFallback: string;
  labels: string[];
  sourcePaths: string[];
};

export type MoveRecord = {
  id: MoveId;
  name: string;
  type: string;
  category: MoveCategory;
  power: number | null;
  accuracy: number | null;
  priority: number;
  target: string;
  flags: string[];
  capabilities?: MoveCapabilities;
  effect: {
    status: string | null;
    volatileStatus: string | null;
    sideCondition: string | null;
    weather: string | null;
    terrain: string | null;
    selfSwitch: boolean;
    healingFraction: number | null;
    drainFraction: number | null;
    recoilFraction: number | null;
    boosts: Record<string, number> | null;
  };
  source: string;
};

export type AbilityRecord = {
  id: AbilityId;
  name: string;
  description: string;
  rating: number | null;
  capabilities: {
    immunities: string[];
    absorptions: string[];
    weather: Exclude<Weather, "random">[];
    weatherDetriments: Exclude<Weather, "random">[];
  };
  source: string;
};

export type MoveCapabilities = {
  hazard: boolean;
  removal: boolean;
  screen: boolean;
  offensiveStat:
    | "attack"
    | "specialAttack"
    | "defense"
    | "specialDefense"
    | null;
  selfBoosts: Record<string, number> | null;
};

export type MovePackageCapabilities = {
  stab: boolean;
  priority: boolean;
  recovery: boolean;
  status: boolean;
  setup: boolean;
  pivoting: boolean;
  hazards: boolean;
  removal: boolean;
  screens: boolean;
  weather: boolean;
};

export type MovePackageQuality = {
  score: number;
  contribution: number;
  capabilities: MovePackageCapabilities;
  strengths: string[];
  concerns: string[];
  explanation: string;
};

export type TeamJob =
  | "physical pressure"
  | "special pressure"
  | "speed control"
  | "defensive switch-in"
  | "sustain"
  | "pivoting"
  | "hazards"
  | "hazard removal"
  | "status pressure"
  | "weather support"
  | "proactive win condition";

export type MemberJobExplanation = {
  speciesId: SpeciesFormId;
  speciesName: string;
  jobs: TeamJob[];
  explanation: string;
};

export type TeamJobQuality = {
  score: number;
  contribution: number;
  coveredJobs: TeamJob[];
  importantGaps: TeamJob[];
  memberExplanations: MemberJobExplanation[];
  proactiveWinCondition: {
    speciesId: SpeciesFormId;
    explanation: string;
  } | null;
  minimumProfile: {
    style: TeamStyle;
    expectations: string[];
    minimumMet: number;
    requiredConditions: string[];
    met: string[];
    missing: string[];
    satisfied: boolean;
  };
  explanation: string;
};

export type StandardStatIndex = StatBlock & {
  level: 50;
  assumedIvs: 31;
  appliedModifiers: string[];
};

export type SpeedPlanQuality = {
  score: number;
  missing: boolean;
  naturalSpeedMembers: SpeciesFormId[];
  priorityMembers: SpeciesFormId[];
  setupMembers: SpeciesFormId[];
  itemMembers: SpeciesFormId[];
  explanation: string;
};

export type ResiliencePlanQuality = {
  score: number;
  effectiveBulk: number;
  switchInCoverage: number;
  recoverySources: SpeciesFormId[];
  immunitySources: SpeciesFormId[];
  explanation: string;
};

export type BattlePlanQuality = {
  score: number;
  contribution: number;
  speed: SpeedPlanQuality;
  physicalResilience: ResiliencePlanQuality;
  specialResilience: ResiliencePlanQuality;
  memberIndices: Array<{
    speciesId: SpeciesFormId;
    speciesName: string;
    stats: StandardStatIndex;
  }>;
  concerns: string[];
  explanation: string;
};

export type ItemRecord = {
  id: ItemId;
  name: string;
  description: string;
  megaStone: SpeciesFormId | null;
  megaEvolves: SpeciesFormId | null;
  capabilities: ItemCapabilities;
  source: string;
};

export type ItemCapabilities = {
  damageCategory: "all" | "physical" | "special" | null;
  choiceLock: boolean;
  recovery: boolean;
  requiredType: string | null;
  defensiveStats: Array<"defense" | "specialDefense">;
  hazardProtection: boolean;
  survival: boolean;
  speedMultiplier: number | null;
  speedStages: number;
  movesLast: boolean;
  recoil: boolean;
  consumable: boolean;
  boostedStats: Array<
    "attack" | "specialAttack" | "defense" | "specialDefense" | "speed"
  >;
  requiresInaccurateMove: boolean;
  damagingMovesOnly: boolean;
  requiresEvolutionPotential: boolean;
};

export type RoleProfile = {
  speciesId: SpeciesFormId;
  roles: string[];
  battleScore: number;
  rationale: string[];
};

export type PokemonRecord = SpeciesRecord & {
  roles: string[];
  battleScore: number;
  availability: AvailabilityRecord;
  build: BuildTemplate;
};

export type GeneratorRequest = {
  schemaVersion: typeof SCHEMA_VERSION;
  dataVersion: typeof DATA_VERSION;
  engineVersion: typeof ENGINE_VERSION;
  seed: string;
  style: TeamStyle;
  weather?: Weather;
  availability: AvailabilityMode;
  allowSpecial: boolean;
  requireMega: boolean;
  slots: [
    SpeciesFormId | null,
    SpeciesFormId | null,
    SpeciesFormId | null,
    SpeciesFormId | null,
    SpeciesFormId | null,
    SpeciesFormId | null,
  ];
};

export type ScoreBreakdown = {
  total: number;
  journeyScore: number;
  battleScore: number;
  roleCoverage: number;
  defensiveFit: number;
  offensiveReach: number;
  journeyFit: number;
  utility: number;
};

export type TeamMember = PokemonRecord & {
  slot: number;
  selectedRole: string;
  mega: boolean;
  gamePlan: string;
  jobs?: TeamJob[];
  jobExplanation?: string;
};

export type TeamWarning = {
  code: string;
  message: string;
  severity: "info" | "warning";
};

export type DataProvenance = {
  dataVersion: typeof DATA_VERSION;
  engineVersion: typeof ENGINE_VERSION;
  generatedAt: string;
  sources: string[];
  verified: boolean;
};

export type TeamResult = {
  members: [
    TeamMember,
    TeamMember,
    TeamMember,
    TeamMember,
    TeamMember,
    TeamMember,
  ];
  score: ScoreBreakdown;
  battleQuality?: {
    ability: {
      contribution: number;
      explanation: string;
    };
    item?: {
      contribution: number;
      explanation: string;
    };
    move?: MovePackageQuality;
    team?: TeamJobQuality;
    plan?: BattlePlanQuality;
  };
  warnings: TeamWarning[];
  provenance: DataProvenance;
};

export type GeneratedTeamResult = TeamResult & {
  members: [
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
    TeamMember & Required<Pick<TeamMember, "jobs" | "jobExplanation">>,
  ];
  battleQuality: {
    ability: NonNullable<TeamResult["battleQuality"]>["ability"];
    item: NonNullable<NonNullable<TeamResult["battleQuality"]>["item"]>;
    move: NonNullable<NonNullable<TeamResult["battleQuality"]>["move"]>;
    team: NonNullable<NonNullable<TeamResult["battleQuality"]>["team"]>;
    plan: NonNullable<NonNullable<TeamResult["battleQuality"]>["plan"]>;
  };
};

export type AlternativeKind = "best" | "easiest" | "different";

export type TeamAlternative = {
  kind: AlternativeKind;
  label: string;
  replacement: TeamMember;
  result: GeneratedTeamResult;
  scoreDelta: number;
  tradeoff: string;
};

export type SavedTeam = {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  request: GeneratorRequest;
  result: TeamResult;
};

export type SharePayload = {
  schemaVersion: typeof SCHEMA_VERSION;
  request: GeneratorRequest;
  result: TeamResult;
};

export type DataManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  dataVersion: typeof DATA_VERSION;
  engineVersion: typeof ENGINE_VERSION;
  generatedAt: string;
  speciesCount: number;
  moveCount: number;
  abilityCount: number;
  itemCount: number;
  buildCount: number;
  finalEvolutionCount: number;
  starterCount: number;
  megaCapableCount: number;
  rejectedCount: number;
  dependencyScan: "all-manifest-archives" | "overrides-only";
  sources: SourceReference[];
  rejected: Array<{
    speciesId?: SpeciesFormId;
    setName?: string;
    reason: string;
    source: string;
  }>;
};

export type SourceReference = {
  name: string;
  version: string;
  url: string;
  checksumAlgorithm: "sha1" | "sha256" | "sha512";
  checksum: string;
  authority:
    | "pack-legality"
    | "species-legality"
    | "mechanics"
    | "recommendation";
};

export type NormalizedCatalog = {
  manifest: DataManifest;
  species: SpeciesRecord[];
  moves: MoveRecord[];
  abilities: AbilityRecord[];
  items: ItemRecord[];
  builds: BuildTemplate[];
  roles: RoleProfile[];
  availability: AvailabilityRecord[];
  typeChart: TypeChart;
};

export type TypeChart = Record<string, Record<string, number>>;
