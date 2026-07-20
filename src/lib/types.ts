export const DATA_VERSION = "cobbleverse-1.7.41b" as const;
export const ENGINE_VERSION = 1 as const;
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
  source: string;
};

export type ItemRecord = {
  id: ItemId;
  name: string;
  description: string;
  megaStone: SpeciesFormId | null;
  megaEvolves: SpeciesFormId | null;
  source: string;
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
  warnings: TeamWarning[];
  provenance: DataProvenance;
};

export type AlternativeKind = "best" | "easiest" | "different";

export type TeamAlternative = {
  kind: AlternativeKind;
  label: string;
  replacement: TeamMember;
  result: TeamResult;
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
