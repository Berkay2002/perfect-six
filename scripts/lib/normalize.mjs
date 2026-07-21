const STAT_KEYS = {
  hp: "hp",
  attack: "attack",
  defence: "defense",
  defense: "defense",
  special_attack: "specialAttack",
  special_defence: "specialDefense",
  special_defense: "specialDefense",
  speed: "speed",
};

export function toId(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeStats(stats = {}) {
  const output = {
    hp: 0,
    attack: 0,
    defense: 0,
    specialAttack: 0,
    specialDefense: 0,
    speed: 0,
  };
  for (const [key, value] of Object.entries(stats)) {
    const normalized = STAT_KEYS[key];
    if (normalized) output[normalized] = Number(value) || 0;
  }
  return output;
}

function normalizeFraction(value) {
  if (!Array.isArray(value) || value.length !== 2 || Number(value[1]) === 0) {
    return null;
  }
  return Number(value[0]) / Number(value[1]);
}

function normalizeAccuracy(value) {
  return typeof value === "number" ? value : null;
}

function normalizeCategory(value) {
  if (value === "Physical" || value === "Special" || value === "Status") {
    return value;
  }
  return "Status";
}

function mergeBoosts(...boostMaps) {
  const merged = {};
  for (const boosts of boostMaps) {
    if (!boosts || typeof boosts !== "object") continue;
    for (const [stat, stages] of Object.entries(boosts)) {
      if (typeof stages === "number") {
        merged[stat] = (merged[stat] ?? 0) + stages;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function normalizeMoveCapabilities(move) {
  const description = `${move.desc ?? ""} ${move.shortDesc ?? ""}`;
  const guaranteedSecondarySelfBoosts =
    Number(move.secondary?.chance) === 100
      ? move.secondary?.self?.boosts
      : null;
  return {
    hazard: Boolean(move.sideCondition && move.target === "foeSide"),
    removal:
      /\b(?:clear|clears|cleared|remove|removed|removes)\b[^.]{0,100}\bhazards?\b/i.test(
        description,
      ) ||
      /\bhazards?\b[^.]{0,60}\b(?:cleared|removed)\b/i.test(
        description,
      ) ||
      /\bends? the effects? of\b[^.]*\b(?:spikes|stealth rock|sticky web|toxic spikes)\b/i.test(
        description,
      ) ||
      /\bends? the effects? of\b[^.]*\bhazards?\b/i.test(description) ||
      /\bthe effects? of\b[^.]{0,300}\b(?:spikes|stealth rock|sticky web|toxic spikes)\b[^.]{0,100}\bend\b/i.test(
        description,
      ),
    screen:
      Boolean(move.sideCondition && move.target === "allySide") &&
      /\bdamage\b[^.]*\b(?:half|halved|reduce|reduced|reduces)\b/i.test(
        description,
      ),
    offensiveStat: /\b(?:user|holder)(?:'s)?\s+(?:defense|def)\s+(?:stat\s+)?as\s+(?:its\s+)?(?:attack|atk)\b/i.test(
      description,
    )
      ? "defense"
      : /\b(?:user|holder)(?:'s)?\s+(?:special defense|sp\. def)\s+(?:stat\s+)?as\s+(?:its\s+)?(?:special attack|sp\. atk)\b/i.test(
            description,
          )
        ? "specialDefense"
        : null,
    selfBoosts: mergeBoosts(
      move.target === "self" ? move.boosts : null,
      move.self?.boosts,
      guaranteedSecondarySelfBoosts,
    ),
  };
}

export function normalizeShowdownMoves(rawMoves, sourceUrl) {
  return Object.entries(rawMoves)
    .map(([key, move]) => ({
      id: toId(move.name || key),
      name: move.name || titleCase(key),
      type: move.type || "Unknown",
      category: normalizeCategory(move.category),
      power: typeof move.basePower === "number" ? move.basePower : null,
      accuracy: normalizeAccuracy(move.accuracy),
      priority: Number(move.priority) || 0,
      target: move.target || "normal",
      flags: Object.keys(move.flags || {}).sort(),
      capabilities: normalizeMoveCapabilities(move),
      effect: {
        status: move.status || null,
        volatileStatus: move.volatileStatus || null,
        sideCondition: move.sideCondition || null,
        weather: move.weather || null,
        terrain: move.terrain || null,
        selfSwitch: Boolean(move.selfSwitch),
        healingFraction: normalizeFraction(move.heal),
        drainFraction: normalizeFraction(move.drain),
        recoilFraction: normalizeFraction(move.recoil),
        boosts:
          move.boosts && typeof move.boosts === "object" ? move.boosts : null,
      },
      source: sourceUrl,
    }))
    .filter((move) => move.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeNamedRecords(rawRecords, sourceUrl) {
  return Object.entries(rawRecords)
    .map(([key, record]) => ({
      id: toId(record.name || key),
      name: record.name || titleCase(key),
      description: record.desc || record.shortDesc || "",
      rating: typeof record.rating === "number" ? record.rating : null,
      megaStone: record.megaStone ? toId(record.megaStone) : null,
      megaEvolves: record.megaEvolves ? toId(record.megaEvolves) : null,
      source: sourceUrl,
    }))
    .filter((record) => record.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

const MODIFIER_WEATHER_TERMS = [
  ["rain", /\brain dance\b|\brain is active\b|\bduring rain\b/i],
  ["sun", /\bsunny day\b|\bsun is active\b|\bharsh sunlight\b/i],
  ["sand", /\bsandstorm\b/i],
  ["snow", /\bsnow\b|\bhail\b/i],
];

function normalizedModifierStats(text) {
  const stats = [];
  for (const label of String(text).split(/\s+and\s+/i)) {
    const normalized = label.toLowerCase().replaceAll(".", "").trim();
    if (normalized === "attack") stats.push("attack");
    if (normalized === "sp atk" || normalized === "special attack") {
      stats.push("specialAttack");
    }
    if (normalized === "defense") stats.push("defense");
    if (normalized === "sp def" || normalized === "special defense") {
      stats.push("specialDefense");
    }
    if (normalized === "speed") stats.push("speed");
  }
  return stats;
}

function numericModifierConditions(clause) {
  const conditions = [];
  for (const [weather, pattern] of MODIFIER_WEATHER_TERMS) {
    if (pattern.test(clause)) {
      conditions.push({ kind: "weather", weather });
    }
  }
  if (/holder's species can evolve/i.test(clause)) {
    conditions.push({ kind: "can-evolve" });
  }
  if (/only select damaging moves/i.test(clause)) {
    conditions.push({ kind: "damaging-moves-only" });
  }
  if (/only select the first move/i.test(clause)) {
    conditions.push({ kind: "choice-lock-compatible" });
  }
  const hasConditionalLanguage =
    /\b(?:if|when|after|during|while|as long as|on switch-in)\b/i.test(clause);
  const hasRepresentedCondition = conditions.length > 0;
  const hasSpeciesCondition = /\b(?:held by|pokemon is)\b/i.test(clause);
  const hasTerrainCondition = /\bterrain\b/i.test(clause);
  return {
    conditions,
    supported:
      !hasSpeciesCondition &&
      !hasTerrainCondition &&
      (!hasConditionalLanguage || hasRepresentedCondition),
  };
}

function multiplierValue(raw) {
  if (/doubled/i.test(raw)) return 2;
  if (/halved/i.test(raw)) return 0.5;
  return Number.parseFloat(raw);
}

function normalizeNumericModifiers(description) {
  const statMultipliers = [];
  const damageTakenMultipliers = [];
  const statPattern =
    /\b((?:(?:Special|Sp\.)\s+(?:Attack|Atk|Defense|Def)|Attack|Defense|Speed)(?:\s+and\s+(?:(?:Special|Sp\.)\s+(?:Attack|Atk|Defense|Def)|Attack|Defense|Speed))*)\s+(?:is|are)\s+(?:(?:multiplied by)\s+)?(\d+(?:\.\d+)?x?|doubled|halved)\b/gi;
  const fractionDamagePattern =
    /\breceives?\s+(\d+)\/(\d+)\s+damage from\s+(physical|special)\s+attacks\b/gi;
  const decimalDamagePattern =
    /\b(?:receives?|takes?)\s+(\d+(?:\.\d+)?)x\s+damage from\s+(physical|special)\s+attacks\b/gi;
  for (const clause of String(description).split(/(?<!\bSp)\.(?!\d)/)) {
    const condition = numericModifierConditions(clause);
    if (!condition.supported) continue;
    for (const match of clause.matchAll(statPattern)) {
      const multiplier = multiplierValue(match[2]);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) {
        continue;
      }
      for (const stat of normalizedModifierStats(match[1])) {
        statMultipliers.push({
          stat,
          multiplier,
          conditions: condition.conditions,
        });
      }
    }
    for (const match of clause.matchAll(fractionDamagePattern)) {
      const multiplier = Number(match[1]) / Number(match[2]);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) {
        continue;
      }
      damageTakenMultipliers.push({
        category: match[3].toLowerCase(),
        multiplier,
        conditions: condition.conditions,
      });
    }
    for (const match of clause.matchAll(decimalDamagePattern)) {
      const multiplier = Number(match[1]);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) {
        continue;
      }
      damageTakenMultipliers.push({
        category: match[2].toLowerCase(),
        multiplier,
        conditions: condition.conditions,
      });
    }
  }
  return { statMultipliers, damageTakenMultipliers };
}

function normalizeAbilityCapabilities(description) {
  const immunities = [
    ...String(description).matchAll(
      /immune to ([a-z]+)-type (?:moves|attacks)/gi,
    ),
  ]
    .map((match) => titleCase(match[1]))
    .sort();
  const beneficialReaction =
    /\b(?:restores?|raises?|boosts?|multiplied|heals?|increases?)\b/i.test(
      description,
    );
  const weatherTerms = [
    ["rain", /\brain dance\b|\brain is active\b|\bduring rain\b/i],
    ["sun", /\bsunny day\b|\bsun is active\b|\bharsh sunlight\b/i],
    ["sand", /\bsandstorm\b/i],
    ["snow", /\bsnow\b|\bhail\b/i],
  ];
  const weather = new Set();
  const weatherDetriments = new Set();
  const weatherSetters = new Set();
  const weatherBenefits = new Set();
  const setterEffect =
    /\b(?:summons?|sets? (?:the )?weather|weather becomes)\b/i;
  const beneficialEffect =
    /\b(?:restores?|heals?|raises?|boosts?|doubled|multiplied|increases?|immune|takes? no damage)\b/i;
  const detrimentalEffect =
    /\b(?:loses?|takes?(?!\s+no\b)|damaged|halved|reduced|lowered|weakened)\b/i;
  for (const clause of String(description).split(
    /\.(?!\d)|;|,\s+and\s+(?=(?:this|it|loses?|restores?|takes?|has|is)\b)/i,
  )) {
    const setter = setterEffect.test(clause);
    const numericMultipliers = [
      ...clause.matchAll(/\bis (\d+(?:\.\d+)?)x\b/gi),
    ].map((match) => Number(match[1]));
    const beneficial =
      beneficialEffect.test(clause) ||
      numericMultipliers.some((multiplier) => multiplier > 1);
    const detrimental =
      detrimentalEffect.test(clause) ||
      numericMultipliers.some((multiplier) => multiplier < 1);
    for (const [condition, pattern] of weatherTerms) {
      if (!pattern.test(clause)) continue;
      if (setter) weatherSetters.add(condition);
      if (beneficial) weatherBenefits.add(condition);
      if (setter || beneficial) weather.add(condition);
      if (detrimental) weatherDetriments.add(condition);
    }
  }

  return {
    immunities,
    absorptions: beneficialReaction ? [...immunities] : [],
    weather: [...weather],
    weatherDetriments: [...weatherDetriments],
    weatherSetters: [...weatherSetters],
    weatherBenefits: [...weatherBenefits],
  };
}

export function normalizeAbilityRecords(rawRecords, sourceUrl) {
  return normalizeNamedRecords(rawRecords, sourceUrl).map((record) => ({
    ...record,
    capabilities: normalizeAbilityCapabilities(record.description),
    modifiers: normalizeNumericModifiers(record.description),
  }));
}

function normalizeItemCapabilities(description) {
  const text = String(description);
  const damageCategory = /\bphysical attacks?\b|holder's Attack is \d/i.test(
    text,
  )
    ? "physical"
    : /\bspecial attacks?\b|holder's Sp\. Atk is \d/i.test(text)
      ? "special"
      : /holder's attacks.*(?:damage|power)/i.test(text)
        ? "all"
        : null;
  const defensiveStats = [];
  if (/\bDefense(?: and| is| are)/i.test(text)) {
    defensiveStats.push("defense");
  }
  if (/\bSp\. Def(?: is| are)?\b/i.test(text)) {
    defensiveStats.push("specialDefense");
  }
  const speedMultiplierMatch = text.match(/\bSpeed is (\d+(?:\.\d+)?)x\b/i);
  const speedStagesMatch = text.match(
    /\bSpeed is (?:raised|boosted) by (\d+) stages?\b/i,
  );
  const requiredTypeMatch = text.match(
    /\bif holder is (?:an? )?([a-z]+) type\b/i,
  );
  const boostedStatsMatch = text.match(
    /\braises? (.+?) by \d+ stages?\b/i,
  );
  const boostedStats = [];
  if (boostedStatsMatch) {
    const boostText = boostedStatsMatch[1];
    if (/\bAttack\b/i.test(boostText)) boostedStats.push("attack");
    if (/\bSp\. Atk\b/i.test(boostText)) boostedStats.push("specialAttack");
    if (/\bDefense\b/i.test(boostText)) boostedStats.push("defense");
    if (/\bSp\. Def\b/i.test(boostText)) {
      boostedStats.push("specialDefense");
    }
    if (/\bSpeed\b/i.test(boostText)) boostedStats.push("speed");
  }

  return {
    damageCategory,
    choiceLock: /only select the first move (?:it|the holder) executes/i.test(
      text,
    ),
    recovery: /\b(?:restores?|gains?)\b[^.]*\bHP\b/i.test(text),
    requiredType: requiredTypeMatch ? titleCase(requiredTypeMatch[1]) : null,
    defensiveStats,
    hazardProtection: /unaffected by hazards/i.test(text),
    survival: /survive an attack that would KO/i.test(text),
    speedMultiplier: speedMultiplierMatch
      ? Number(speedMultiplierMatch[1])
      : /\bSpeed (?:is )?halved\b/i.test(text)
        ? 0.5
        : null,
    speedStages: speedStagesMatch ? Number(speedStagesMatch[1]) : 0,
    movesLast: /\bmoves last\b/i.test(text),
    recoil:
      /(?:holder|\bit\b) loses [^.]*HP after (?:an|the) attack/i.test(text),
    consumable: /\bSingle use\b/i.test(text),
    boostedStats,
    requiresInaccurateMove: /misses due to accuracy/i.test(text),
    damagingMovesOnly: /only select damaging moves/i.test(text),
    requiresEvolutionPotential: /holder's species can evolve/i.test(text),
  };
}

export function normalizeItemRecords(rawRecords, sourceUrl) {
  return normalizeNamedRecords(rawRecords, sourceUrl).map((record) => ({
    ...record,
    capabilities: normalizeItemCapabilities(record.description),
    modifiers: normalizeNumericModifiers(record.description),
  }));
}

function parseLearnMethod(raw) {
  const prefix = String(raw).split(":")[0]?.toLowerCase();
  if (/^\d+$/.test(prefix)) return "level";
  if (
    prefix === "egg" ||
    prefix === "tm" ||
    prefix === "tutor" ||
    prefix === "legacy" ||
    prefix === "special"
  ) {
    return prefix;
  }
  return "other";
}

function parseMoveId(raw) {
  const value = String(raw);
  const colon = value.indexOf(":");
  return toId(colon >= 0 ? value.slice(colon + 1) : value);
}

function normalizeLearnset(rawMoves = []) {
  const byMove = new Map();
  for (const raw of rawMoves) {
    const moveId = parseMoveId(raw);
    if (!moveId) continue;
    const current = byMove.get(moveId) || {
      moveId,
      methods: new Set(),
      raw: [],
    };
    current.methods.add(parseLearnMethod(raw));
    current.raw.push(String(raw));
    byMove.set(moveId, current);
  }
  return [...byMove.values()]
    .map((entry) => ({
      moveId: entry.moveId,
      methods: [...entry.methods].sort(),
      raw: entry.raw.sort(),
    }))
    .sort((left, right) => left.moveId.localeCompare(right.moveId));
}

function normalizeEvolutions(evolutions = []) {
  return evolutions
    .map((evolution) => {
      const requirements = Array.isArray(evolution.requirements)
        ? evolution.requirements
        : [];
      const level = requirements.find(
        (requirement) => requirement?.variant === "level",
      );
      const item = requirements.find(
        (requirement) =>
          requirement?.variant === "held_item" ||
          requirement?.variant === "use_item",
      );
      return {
        targetId: toId(evolution.result),
        variant: evolution.variant || "unknown",
        ...(typeof level?.minLevel === "number"
          ? { minimumLevel: level.minLevel }
          : {}),
        ...(item?.item ? { requiredItemId: toId(item.item) } : {}),
        rawRequirements: requirements,
      };
    })
    .filter((evolution) => evolution.targetId)
    .sort((left, right) => left.targetId.localeCompare(right.targetId));
}

function normalizeAbilities(abilities = []) {
  return abilities
    .map((ability) => toId(String(ability).replace(/^h:/, "")))
    .filter(Boolean)
    .sort();
}

function normalizeSpecialClasses(tags = []) {
  const normalized = tags.map((tag) => String(tag).toLowerCase());
  const classes = [];
  if (normalized.some((tag) => tag.includes("legendary"))) {
    classes.push("legendary");
  }
  if (normalized.some((tag) => tag.includes("mythical"))) {
    classes.push("mythical");
  }
  if (normalized.some((tag) => tag.includes("ultra beast"))) {
    classes.push("ultra-beast");
  }
  if (normalized.some((tag) => tag.includes("paradox"))) {
    classes.push("paradox");
  }
  return classes;
}

function showdownLearnsetFor(id, rawLearnsets) {
  const entry = rawLearnsets[id]?.learnset || {};
  const rows = [];
  for (const [moveId, methods] of Object.entries(entry)) {
    for (const method of methods) rows.push(`${method}:${moveId}`);
  }
  return normalizeLearnset(rows);
}

function mergeLearnsets(primary = [], fallback = []) {
  const merged = new Map();
  for (const entry of [...fallback, ...primary]) {
    const current = merged.get(entry.moveId);
    if (!current) {
      merged.set(entry.moveId, {
        moveId: entry.moveId,
        methods: [...entry.methods],
        raw: [...entry.raw],
      });
      continue;
    }
    current.methods = [...new Set([...current.methods, ...entry.methods])].sort();
    current.raw = [...new Set([...current.raw, ...entry.raw])].sort();
  }
  return [...merged.values()].sort((left, right) =>
    left.moveId.localeCompare(right.moveId),
  );
}

function artworkFor(dexNumber) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexNumber}.png`;
}

function spriteFor(id) {
  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

export function normalizeSpecies({
  cobblemonDocuments,
  overlayDocuments,
  showdownPokedex,
  showdownLearnsets,
  rejected,
}) {
  const sourceById = new Map();
  const additions = [];
  const fullDocuments = [];

  for (const document of [...cobblemonDocuments, ...overlayDocuments]) {
    const data = document.data;
    if (!data || typeof data !== "object") continue;
    if (document.kind === "species-addition") {
      additions.push(document);
      continue;
    }
    fullDocuments.push(document);
  }

  const definitions = new Map();
  for (const document of fullDocuments) {
    const data = document.data;
    const baseId = toId(data.name || document.filename);
    if (!baseId || !data.nationalPokedexNumber) continue;
    definitions.set(baseId, {
      data: structuredClone(data),
      paths: [document.path],
      authority: document.authority,
    });
  }

  const rewrittenFields = new Map();
  for (const document of additions) {
    const patch = document.data;
    const targetId = toId(String(patch.target || "").split(":").at(-1));
    const definition = definitions.get(targetId);
    if (!definition) {
      rejected.push({
        source: document.path,
        reason: `Species addition target "${patch.target}" does not resolve.`,
      });
      continue;
    }
    const fields = rewrittenFields.get(targetId) || new Set();
    for (const [key, value] of Object.entries(patch)) {
      if (key === "target") continue;
      if (key === "forms" || key === "evolutions") {
        const existing = Array.isArray(definition.data[key])
          ? definition.data[key]
          : [];
        definition.data[key] = [
          ...existing,
          ...(Array.isArray(value) ? structuredClone(value) : []),
        ];
        continue;
      }
      if (!fields.has(key)) {
        definition.data[key] = structuredClone(value);
        fields.add(key);
      } else {
        rejected.push({
          source: document.path,
          reason: `Later species addition for "${targetId}" could not rewrite already-added field "${key}" under Cobblemon first-addition-wins semantics.`,
        });
      }
    }
    rewrittenFields.set(targetId, fields);
    definition.paths.push(document.path);
  }

  for (const [baseId, definition] of definitions) {
    const data = definition.data;
    sourceById.set(baseId, {
      data,
      baseId,
      baseName: data.name,
      paths: definition.paths,
      authority: definition.authority,
    });
    for (const form of data.forms || []) {
      const formId = `${baseId}${toId(form.name)}`;
      sourceById.set(formId, {
        data: {
          ...data,
          ...form,
          name: `${data.name}-${form.name}`,
          nationalPokedexNumber: data.nationalPokedexNumber,
          abilities: form.abilities || data.abilities,
          baseStats: form.baseStats || data.baseStats,
          moves: form.moves || data.moves,
        },
        baseId,
        baseName: data.name,
        paths: definition.paths,
        authority: definition.authority,
      });
    }
  }

  const allIds = new Set(sourceById.keys());

  const records = [];
  for (const id of [...allIds].sort()) {
    const showdown = showdownPokedex[id] || {};
    const source = sourceById.get(id);
    if (!source) continue;

    const raw = source?.data || {};
    const dexNumber = Number(raw.nationalPokedexNumber || showdown.num);
    if (!Number.isFinite(dexNumber) || dexNumber <= 0) continue;

    const types = [
      raw.primaryType || showdown.types?.[0],
      raw.secondaryType || showdown.types?.[1],
    ]
      .filter(Boolean)
      .map(titleCase);
    const evolutions = normalizeEvolutions(raw.evolutions);
    const sourceLearnset = normalizeLearnset(raw.moves);
    const fallbackLearnset = showdownLearnsetFor(id, showdownLearnsets);
    const rawLabels = [...(raw.labels || []), ...(raw.aspects || [])].map(
      String,
    );
    const regionalForm = rawLabels.some(
      (label) =>
        label.endsWith("_form") &&
        rawLabels.includes(label.slice(0, -"_form".length)),
    );
    const battleOnly = Boolean(raw.battleOnly);

    records.push({
      id,
      dexNumber,
      name: raw.name || showdown.name || titleCase(id),
      baseSpecies:
        showdown.baseSpecies ||
        source.baseName ||
        raw.name ||
        showdown.name ||
        titleCase(id),
      types: types.length > 1 ? [types[0], types[1]] : [types[0] || "Unknown"],
      stats: normalizeStats(raw.baseStats || showdown.baseStats),
      abilities:
        normalizeAbilities(raw.abilities).length > 0
          ? normalizeAbilities(raw.abilities)
          : normalizeAbilities(Object.values(showdown.abilities || {})),
      learnset:
        sourceLearnset.length > 0
          ? sourceLearnset
          : mergeLearnsets([], fallbackLearnset),
      evolutions,
      preEvolutionId: raw.preEvolution
        ? toId(raw.preEvolution)
        : showdown.prevo
          ? toId(showdown.prevo)
          : null,
      finalEvolution: evolutions.length === 0 && !showdown.evos?.length,
      battleOnly,
      formKind:
        id === source.baseId
          ? "base"
          : battleOnly
            ? "battle"
            : regionalForm
              ? "regional"
              : "alternate",
      starter: Array.isArray(raw.labels) && raw.labels.includes("starter"),
      specialClasses: normalizeSpecialClasses([
        ...(raw.labels || []),
        ...(showdown.tags || []),
      ]),
      megaFormIds: [],
      artwork: artworkFor(dexNumber),
      spriteFallback: spriteFor(id),
      labels: [
        ...new Set([
          ...(raw.labels || []),
          ...(raw.aspects || []),
          ...(showdown.tags || []),
        ]),
      ].sort(),
      sourcePaths: source.paths,
    });
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    const showdown = showdownPokedex[record.id] || {};
    const baseId = toId(showdown.baseSpecies);
    const isMega =
      String(showdown.forme || "").toLowerCase().includes("mega") ||
      record.name.toLowerCase().includes("-mega") ||
      record.labels.some((label) => String(label).toLowerCase().includes("mega"));
    if (isMega && baseId && byId.has(baseId)) {
      byId.get(baseId).megaFormIds.push(record.id);
    }
  }

  const starterRoots = new Set(
    records.filter((record) => record.starter).map((record) => record.id),
  );
  for (const record of records) {
    if (!["base", "regional"].includes(record.formKind)) continue;
    let cursor = record;
    const visited = new Set();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      if (starterRoots.has(cursor.id)) {
        record.starter = true;
        break;
      }
      cursor = cursor.preEvolutionId ? byId.get(cursor.preEvolutionId) : null;
    }
  }

  return records.sort((left, right) => {
    if (left.dexNumber !== right.dexNumber) return left.dexNumber - right.dexNumber;
    return left.id.localeCompare(right.id);
  });
}

function optionValues(value) {
  if (Array.isArray(value)) return value.flatMap(optionValues);
  return value == null ? [] : [value];
}

function emptyEvs() {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    specialAttack: 0,
    specialDefense: 0,
    speed: 0,
  };
}

function normalizeEvs(raw = {}) {
  const evs = emptyEvs();
  const keys = {
    hp: "hp",
    atk: "attack",
    def: "defense",
    spa: "specialAttack",
    spd: "specialDefense",
    spe: "speed",
  };
  for (const [key, value] of Object.entries(raw)) {
    if (keys[key]) evs[keys[key]] = Number(value) || 0;
  }
  return evs;
}

function movePurpose(move) {
  if (move.category === "Status") {
    if (move.effect.healingFraction) return "Recovery";
    if (move.effect.sideCondition) return "Team utility";
    if (move.effect.status || move.effect.volatileStatus) return "Status control";
    if (move.effect.boosts) return "Setup";
    return "Utility";
  }
  if (move.effect.selfSwitch) return "Damage and pivot";
  return "Reliable damage";
}

function toMoveBuild(move) {
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    purpose: movePurpose(move),
  };
}

export function normalizeSmogonBuilds({
  rawSets,
  species,
  moves,
  abilities,
  items,
  sourceUrl,
  rejected,
}) {
  const speciesById = new Map(species.map((record) => [record.id, record]));
  const moveById = new Map(moves.map((record) => [record.id, record]));
  const abilityIds = new Set(abilities.map((record) => record.id));
  const itemIds = new Set(items.map((record) => record.id));
  const builds = [];
  const looksLikeNamedSets = (value) =>
    value &&
    typeof value === "object" &&
    Object.values(value).some(
      (set) => set && typeof set === "object" && Array.isArray(set.moves),
    );
  const sourceFormat = sourceUrl.match(/\/(gen\d+)\.json$/)?.[1] || "smogon";
  const groups = [];
  function findSetGroups(value, path = []) {
    if (!value || typeof value !== "object") return;
    if (looksLikeNamedSets(value)) {
      const speciesIndex = path.findLastIndex((segment) =>
        speciesById.has(toId(segment)),
      );
      if (speciesIndex >= 0) {
        const speciesId = toId(path[speciesIndex]);
        const qualifiers = path.filter((_, index) => index !== speciesIndex);
        groups.push({
          speciesId,
          format: [sourceFormat, ...qualifiers.map(toId)]
            .filter(Boolean)
            .join("-"),
          namedSets: value,
        });
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      findSetGroups(child, [...path, key]);
    }
  }
  findSetGroups(rawSets);

  for (const { format, speciesId, namedSets } of groups.sort(
    (left, right) =>
      left.speciesId.localeCompare(right.speciesId) ||
      left.format.localeCompare(right.format),
  )) {
    const pokemon = speciesById.get(speciesId);
    if (!pokemon) continue;
    const legalMoves = new Set(pokemon.learnset.map((entry) => entry.moveId));

    for (const [setName, set] of Object.entries(namedSets)) {
        const chosenMoves = [];
        for (const slot of set.moves || []) {
          const legal = optionValues(slot)
            .map(toId)
            .filter((moveId) => legalMoves.has(moveId) && moveById.has(moveId))
            .sort();
          if (legal[0]) chosenMoves.push(legal[0]);
        }
        const abilityId = optionValues(set.ability)
          .map(toId)
          .filter((id) => pokemon.abilities.includes(id) && abilityIds.has(id))
          .sort()[0];
        const heldItemId = optionValues(set.item)
          .map(toId)
          .filter((id) => itemIds.has(id))
          .sort()[0];
        const nature = optionValues(set.nature).map(String).sort()[0];

        const invalidReasons = [];
        if (chosenMoves.length !== 4) invalidReasons.push("not four legal moves");
        if (!abilityId) invalidReasons.push("illegal or unknown ability");
        if (!heldItemId) invalidReasons.push("unknown item");
        if (!nature) invalidReasons.push("missing nature");
        if (invalidReasons.length > 0) {
          rejected.push({
            speciesId,
            setName,
            source: sourceUrl,
            reason: invalidReasons.join(", "),
          });
          continue;
        }

        const ability = abilities.find((entry) => entry.id === abilityId);
        const item = items.find((entry) => entry.id === heldItemId);
        builds.push({
          id: `${speciesId}:${toId(format)}:${toId(setName)}`,
          speciesId,
          source: {
            kind: "smogon",
            format,
            url: sourceUrl,
            setName,
          },
          abilityId,
          ability: ability.name,
          nature,
          heldItemId,
          heldItem: item.name,
          evs: normalizeEvs(set.evs),
          moves: chosenMoves.map((moveId) => toMoveBuild(moveById.get(moveId))),
          practicalSubstitute:
            "Generated later from next-best legal sourced move, ability, or item.",
        });
    }
  }

  return builds.sort((left, right) => left.id.localeCompare(right.id));
}

export function deriveMissingBuilds({
  species,
  moves,
  abilities,
  items,
  importedBuilds,
  rejected,
}) {
  const existing = new Set(importedBuilds.map((build) => build.speciesId));
  const moveById = new Map(moves.map((move) => [move.id, move]));
  const abilityById = new Map(abilities.map((ability) => [ability.id, ability]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const nonMegaBuilds = importedBuilds.filter(
    (build) => !itemById.get(build.heldItemId)?.megaStone,
  );

  const modeForBuild = (build) => {
    const physical = build.moves.filter(
      (move) => move.category === "Physical",
    ).length;
    const special = build.moves.filter(
      (move) => move.category === "Special",
    ).length;
    return physical > special ? "physical" : special > physical ? "special" : "mixed";
  };
  const cohorts = new Map();
  for (const build of nonMegaBuilds) {
    const mode = modeForBuild(build);
    const current = cohorts.get(mode) || [];
    current.push(build);
    cohorts.set(mode, current);
  }
  const modal = (values, key = (value) => JSON.stringify(value)) => {
    const counts = new Map();
    for (const value of values) {
      const id = key(value);
      const entry = counts.get(id) || { value, count: 0 };
      entry.count += 1;
      counts.set(id, entry);
    }
    return [...counts.values()].sort(
      (left, right) =>
        right.count - left.count ||
        key(left.value).localeCompare(key(right.value)),
    )[0]?.value;
  };

  const derived = [];
  for (const pokemon of species) {
    if (
      existing.has(pokemon.id) ||
      !pokemon.finalEvolution ||
      pokemon.battleOnly
    ) {
      continue;
    }
    const preferred =
      pokemon.stats.attack > pokemon.stats.specialAttack * 1.1
        ? "physical"
        : pokemon.stats.specialAttack > pokemon.stats.attack * 1.1
          ? "special"
          : "mixed";
    const legalMoves = pokemon.learnset
      .map((entry) => moveById.get(entry.moveId))
      .filter(Boolean);
    const scored = legalMoves
      .map((move) => {
        const damaging = move.category !== "Status";
        const preferredCategory =
          preferred === "mixed" ||
          move.category.toLowerCase() === preferred;
        const accuracy = move.accuracy === null ? 0.85 : move.accuracy / 100;
        const sourceUtility = [
          move.effect.healingFraction,
          move.effect.status,
          move.effect.volatileStatus,
          move.effect.sideCondition,
          move.effect.selfSwitch,
          move.effect.boosts,
          move.effect.weather,
          move.effect.terrain,
        ].filter(Boolean).length;
        const score =
          (damaging ? (move.power || 0) * accuracy : 22 + sourceUtility * 12) +
          (pokemon.types.includes(move.type) ? 24 : 0) +
          (preferredCategory ? 18 : 0) +
          (move.priority > 0 ? 8 : 0);
        return { move, score };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.move.id.localeCompare(right.move.id),
      );
    const selected = [];
    const utility = scored.find((entry) => entry.move.category === "Status");
    if (utility) selected.push(utility.move);
    for (const entry of scored) {
      if (selected.some((move) => move.id === entry.move.id)) continue;
      selected.push(entry.move);
      if (selected.length === 4) break;
    }
    const legalAbilities = pokemon.abilities
      .map((id) => abilityById.get(id))
      .filter(Boolean)
      .sort(
        (left, right) =>
          (right.rating ?? 0) - (left.rating ?? 0) ||
          left.id.localeCompare(right.id),
      );
    const cohort = cohorts.get(preferred) || nonMegaBuilds;
    const pattern = modal(cohort, (build) =>
      JSON.stringify({
        item: build.heldItemId,
        nature: build.nature,
        evs: build.evs,
      }),
    );
    const heldItem = pattern ? itemById.get(pattern.heldItemId) : null;
    if (
      selected.length !== 4 ||
      legalAbilities.length === 0 ||
      !pattern ||
      !heldItem
    ) {
      rejected.push({
        speciesId: pokemon.id,
        source: "derived-policy",
        reason:
          "Could not derive complete build from sourced legal moves, abilities, and validated set patterns.",
      });
      continue;
    }
    const substitute = scored.find(
      (entry) => !selected.some((move) => move.id === entry.move.id),
    )?.move;
    derived.push({
      id: `${pokemon.id}:derived:source-backed`,
      speciesId: pokemon.id,
      source: {
        kind: "derived",
        format: "source-backed",
        url: "docs/data/README.md",
      },
      abilityId: legalAbilities[0].id,
      ability: legalAbilities[0].name,
      nature: pattern.nature,
      heldItemId: heldItem.id,
      heldItem: heldItem.name,
      evs: pattern.evs,
      moves: selected.map(toMoveBuild),
      practicalSubstitute: substitute
        ? `${substitute.name} is next-ranked legal sourced move.`
        : "No fifth legal sourced move ranked.",
    });
  }
  return derived.sort((left, right) => left.id.localeCompare(right.id));
}

export function validateCatalog({ species, moves, abilities, items, builds }) {
  const failures = [];
  const speciesById = new Map(species.map((record) => [record.id, record]));
  const moveIds = new Set(moves.map((record) => record.id));
  const abilityIds = new Set(abilities.map((record) => record.id));
  const itemIds = new Set(items.map((record) => record.id));

  for (const build of builds) {
    const pokemon = speciesById.get(build.speciesId);
    if (!pokemon) {
      failures.push(`${build.id}: unknown species`);
      continue;
    }
    const learnset = new Set(pokemon.learnset.map((entry) => entry.moveId));
    for (const move of build.moves) {
      if (!moveIds.has(move.id) || !learnset.has(move.id)) {
        failures.push(`${build.id}: illegal move ${move.id}`);
      }
    }
    if (
      !abilityIds.has(build.abilityId) ||
      !pokemon.abilities.includes(build.abilityId)
    ) {
      failures.push(`${build.id}: illegal ability ${build.abilityId}`);
    }
    if (!itemIds.has(build.heldItemId)) {
      failures.push(`${build.id}: unknown item ${build.heldItemId}`);
    }
  }
  return failures;
}
