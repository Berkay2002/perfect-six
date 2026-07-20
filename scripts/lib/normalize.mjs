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

  for (const document of [...cobblemonDocuments, ...overlayDocuments]) {
    const data = document.data;
    if (!data || typeof data !== "object") continue;
    if (document.kind === "species-addition") {
      rejected.push({
        source: document.path,
        reason:
          "Species addition retained for provenance but not applied because target-patch semantics require runtime registry resolution.",
      });
      continue;
    }
    const baseId = toId(data.name || document.filename);
    if (!baseId || !data.nationalPokedexNumber) continue;
    sourceById.set(baseId, {
      data,
      baseId,
      baseName: data.name,
      path: document.path,
      authority: document.authority,
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
        path: document.path,
        authority: document.authority,
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
      battleOnly: Boolean(raw.battleOnly),
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
      sourcePaths: [source.path],
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
  const formats = Object.entries(rawSets).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [format, formatSpecies] of formats) {
    if (!formatSpecies || typeof formatSpecies !== "object") continue;
    for (const [speciesName, namedSets] of Object.entries(formatSpecies)) {
      const speciesId = toId(speciesName);
      const pokemon = speciesById.get(speciesId);
      if (!pokemon || !namedSets || typeof namedSets !== "object") continue;
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
  }

  return builds.sort((left, right) => left.id.localeCompare(right.id));
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
