import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { ENGINE_VERSION } from "../data/engine-version.mjs";
import {
  deriveMissingBuilds,
  normalizeAbilityRecords,
  normalizeItemRecords,
  normalizeShowdownMoves,
  normalizeSmogonBuilds,
  normalizeSpecies,
  toId,
  validateCatalog,
} from "./lib/normalize.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cacheRoot = path.join(projectRoot, ".cache", "perfect-six");
const generatedRoot = path.join(projectRoot, "src", "data", "generated");
const reportRoot = path.join(projectRoot, "docs", "data");
const lock = JSON.parse(
  await readFile(path.join(projectRoot, "data", "sources.lock.json"), "utf8"),
);
const args = new Set(process.argv.slice(2));
const scanDependencies = !args.has("--skip-pack-dependencies");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function checksum(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(url, destination, expected = {}) {
  await mkdir(path.dirname(destination), { recursive: true });
  if (await exists(destination)) {
    const matches = await verifyExpected(destination, expected);
    if (matches) return destination;
  }

  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  await downloadStream(url, temporary);
  if (!(await verifyExpected(temporary, expected))) {
    await rm(temporary, { force: true });
    throw new Error(`Checksum or size mismatch for ${url}`);
  }
  await rename(temporary, destination);
  return destination;
}

async function downloadStream(url, destination, redirects = 0) {
  if (redirects > 5) throw new Error(`Too many redirects for ${url}`);
  const protocol = url.startsWith("https:") ? https : http;
  await new Promise((resolve, reject) => {
    const request = protocol.get(
      url,
      {
        headers: {
          Accept: "application/octet-stream, application/zip, */*",
          "User-Agent":
            "Mozilla/5.0 (compatible; PerfectSixDataPipeline/1.0; +https://github.com/)",
        },
      },
      async (response) => {
        const status = response.statusCode ?? 0;
        if (
          status >= 300 &&
          status < 400 &&
          typeof response.headers.location === "string"
        ) {
          response.resume();
          try {
            await downloadStream(
              new URL(response.headers.location, url).toString(),
              destination,
              redirects + 1,
            );
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Download failed (${status}) for ${url}`));
          return;
        }
        try {
          await pipeline(response, createWriteStream(destination));
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
}

async function verifyExpected(file, expected) {
  if (expected.size) {
    const { size } = await stat(file);
    if (size !== expected.size) return false;
  }
  for (const algorithm of ["sha1", "sha512"]) {
    if (
      expected[algorithm] &&
      (await checksum(file, algorithm)) !== expected[algorithm]
    ) {
      return false;
    }
  }
  return true;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "perfect-six-data-pipeline/1" },
  });
  if (!response.ok) {
    throw new Error(`JSON request failed (${response.status}) for ${url}`);
  }
  const raw = await response.text();
  return {
    data: JSON.parse(raw),
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "perfect-six-data-pipeline/1" },
  });
  if (!response.ok) {
    throw new Error(`Text request failed (${response.status}) for ${url}`);
  }
  const raw = await response.text();
  return {
    raw,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function normalizeTypeChart(source) {
  const rawChart = parseShowdownExport(source, "BattleTypeChart");
  const multiplierByCode = { 0: 1, 1: 2, 2: 0.5, 3: 0 };
  const chart = {};
  for (const [defenderId, defender] of Object.entries(rawChart)) {
    const defenderName =
      defenderId.charAt(0).toUpperCase() + defenderId.slice(1);
    for (const [attackerName, code] of Object.entries(
      defender.damageTaken || {},
    )) {
      if (!/^[A-Z]/.test(attackerName)) continue;
      chart[attackerName] ||= {};
      chart[attackerName][defenderName] = multiplierByCode[code] ?? 1;
    }
  }
  return chart;
}

function parseShowdownExport(source, exportName) {
  const sandbox = { exports: Object.create(null) };
  vm.runInNewContext(source, sandbox, {
    filename: `pokemon-showdown-${exportName}.js`,
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  const exported = sandbox.exports[exportName];
  if (!exported || typeof exported !== "object") {
    throw new Error(`Pokemon Showdown data did not expose ${exportName}.`);
  }
  return exported;
}

async function openZip(fileOrBuffer) {
  const { Open } = await import("unzipper");
  return Buffer.isBuffer(fileOrBuffer)
    ? Open.buffer(fileOrBuffer)
    : Open.file(fileOrBuffer);
}

function archiveKind(entryPath) {
  const normalized = entryPath.replaceAll("\\", "/").toLowerCase();
  if (/\/data\/[^/]+\/species\/.+\.json$/.test(`/${normalized}`)) {
    return "species";
  }
  if (/\/data\/[^/]+\/species_additions\/.+\.json$/.test(`/${normalized}`)) {
    return "species-addition";
  }
  if (/\/data\/[^/]+\/spawn_pool_world\/.+\.json$/.test(`/${normalized}`)) {
    return "spawn";
  }
  if (/\/data\/[^/]+\/starters?\/.+\.json$/.test(`/${normalized}`)) {
    return "starter";
  }
  return null;
}

async function jsonDocumentsFromDirectory(directory, authority, prefix) {
  const documents = [];
  for (const entry of directory.files) {
    const kind = archiveKind(entry.path);
    if (!kind || entry.type === "Directory") continue;
    try {
      documents.push({
        authority,
        kind,
        path: `${prefix}!/${entry.path}`,
        filename: path.basename(entry.path, ".json"),
        data: JSON.parse((await entry.buffer()).toString("utf8")),
      });
    } catch (error) {
      documents.push({
        authority,
        kind: "rejected-json",
        path: `${prefix}!/${entry.path}`,
        filename: path.basename(entry.path, ".json"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return documents;
}

async function inspectArchive(file, authority, prefix = file) {
  return jsonDocumentsFromDirectory(await openZip(file), authority, prefix);
}

async function readMrpack(mrpackFile) {
  const directory = await openZip(mrpackFile);
  const indexEntry = directory.files.find(
    (entry) => entry.path === "modrinth.index.json",
  );
  if (!indexEntry) throw new Error("mrpack has no modrinth.index.json");
  const index = JSON.parse((await indexEntry.buffer()).toString("utf8"));
  const directDocuments = await jsonDocumentsFromDirectory(
    directory,
    "pack-legality",
    mrpackFile,
  );

  const nestedDocuments = [];
  for (const entry of directory.files) {
    const normalized = entry.path.toLowerCase();
    if (
      entry.type !== "Directory" &&
      /^((server-)?overrides)\/.+\.(zip|jar)$/.test(normalized)
    ) {
      try {
        const nested = await openZip(await entry.buffer());
        nestedDocuments.push(
          ...(await jsonDocumentsFromDirectory(
            nested,
            "pack-legality",
            `${mrpackFile}!/${entry.path}`,
          )),
        );
      } catch {
        // Non-zip files can carry zip-looking extensions. Rejected elsewhere.
      }
    }
  }
  return { index, documents: [...directDocuments, ...nestedDocuments] };
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return output;
}

async function inspectPackDependencies(index) {
  if (!scanDependencies) return [];
  const archives = index.files
    .filter((entry) => /\.(jar|zip)$/i.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const groups = await mapLimit(archives, 4, async (entry) => {
    const destination = path.join(cacheRoot, "pack-files", entry.path);
    await download(entry.downloads[0], destination, {
      sha1: entry.hashes?.sha1,
      sha512: entry.hashes?.sha512,
    });
    try {
      return await inspectArchive(destination, "pack-legality", entry.path);
    } catch {
      return [];
    }
  });
  return groups.flat();
}

function deriveAvailability(species, spawnDocuments) {
  function referencedSpecies(value, output = new Set()) {
    if (Array.isArray(value)) {
      for (const entry of value) referencedSpecies(entry, output);
      return output;
    }
    if (!value || typeof value !== "object") return output;
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (
        typeof entry === "string" &&
        ["pokemon", "species", "result"].includes(normalizedKey)
      ) {
        const identifier = entry.trim().split(/\s+/)[0].split(":").at(-1);
        if (identifier) output.add(toId(identifier));
      } else {
        referencedSpecies(entry, output);
      }
    }
    return output;
  }
  const spawnReferences = spawnDocuments.map((document) => ({
    path: document.path,
    species: referencedSpecies(document.data),
  }));
  const byId = new Map(species.map((pokemon) => [pokemon.id, pokemon]));

  return species.map((pokemon) => {
    let cursor = pokemon;
    let evolutionSteps = 0;
    let matchedId = pokemon.id;
    let matching = spawnReferences.filter(({ species: references }) =>
      references.has(matchedId),
    );
    const visited = new Set();
    while (
      matching.length === 0 &&
      cursor.preEvolutionId &&
      !visited.has(cursor.id)
    ) {
      visited.add(cursor.id);
      cursor = byId.get(cursor.preEvolutionId);
      if (!cursor) break;
      evolutionSteps += 1;
      matchedId = cursor.id;
      matching = spawnReferences.filter(({ species: references }) =>
        references.has(matchedId),
      );
    }
    const evidence = matching
      .slice(0, 5)
      .map(({ path: sourcePath }) => ({
        kind: evolutionSteps > 0 ? "evolution" : "spawn",
        sourcePath,
        summary:
          evolutionSteps > 0
            ? `Sourced ancestor "${matchedId}" appears in spawn definition; ${evolutionSteps} evolution step(s) required.`
            : "Exact species identifier appears in sourced spawn definition.",
      }));
    const starterEvidence = pokemon.starter
      ? [
          {
            kind: "evolution",
            sourcePath: pokemon.sourcePaths[0] || "species-data",
            summary:
              "Starter classification and evolution ancestry verified from species data.",
          },
        ]
      : [];
    const score =
      starterEvidence.length > 0
        ? 90
        : evidence.length > 0
          ? Math.max(45, 82 - evolutionSteps * 8)
          : 25;
    const difficulty =
      score >= 82
        ? "Easy"
        : score >= 65
          ? "Moderate"
          : score >= 40
            ? "Hard"
            : "Late game";
    const stage = score >= 82 ? "Early" : score >= 55 ? "Mid" : "Late";
    return {
      speciesId: pokemon.id,
      difficulty,
      stage,
      evolutionLine: pokemon.preEvolutionId
        ? `Evolves from ${pokemon.preEvolutionId}`
        : pokemon.evolutions.length
          ? `Evolves into ${pokemon.evolutions.map((entry) => entry.targetId).join(", ")}`
          : "Final evolution",
      guidance:
        starterEvidence.length > 0
          ? "Obtain starter form through sourced starter path, then evolve."
          : evidence.length > 0
          ? "See sourced spawn evidence."
          : "No verified spawn rule found in scanned snapshot.",
      score,
      evidence:
        starterEvidence.length > 0 || evidence.length > 0
          ? [...starterEvidence, ...evidence]
          : [
              {
                kind: "unknown",
                sourcePath: "pipeline",
                summary: "Acquisition not verified; scored conservatively.",
              },
            ],
    };
  });
}

function deriveRoles(species, builds) {
  const buildsBySpecies = new Map();
  for (const build of builds) {
    const current = buildsBySpecies.get(build.speciesId) || [];
    current.push(build);
    buildsBySpecies.set(build.speciesId, current);
  }
  return species.map((pokemon) => {
    const physical = pokemon.stats.attack;
    const special = pokemon.stats.specialAttack;
    const bulk =
      pokemon.stats.hp + pokemon.stats.defense + pokemon.stats.specialDefense;
    const sourcedBuilds = buildsBySpecies.get(pokemon.id) || [];
    const roles = [];
    if (physical > special * 1.12) roles.push("Physical attacker");
    if (special > physical * 1.12) roles.push("Special attacker");
    if (Math.abs(physical - special) <= Math.max(physical, special) * 0.12) {
      roles.push("Mixed attacker");
    }
    if (bulk >= 285) roles.push("Bulky support");
    if (pokemon.stats.speed >= 100) roles.push("Speed control");
    if (roles.length === 0) roles.push("Flexible");
    return {
      speciesId: pokemon.id,
      roles,
      battleScore: Math.min(
        100,
        Math.round(
          (physical +
            special +
            bulk +
            pokemon.stats.speed +
            Math.min(20, sourcedBuilds.length * 2)) /
            7,
        ),
      ),
      rationale: [
        "Role labels derived from sourced base stats.",
        `${sourcedBuilds.length} validated recommendation set(s) available.`,
      ],
    };
  });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeGenerated(name, value) {
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, name), stableJson(value), "utf8");
}

await mkdir(cacheRoot, { recursive: true });
await mkdir(reportRoot, { recursive: true });

const cobbleverse = lock.sources.cobbleverse;
const mrpackFile = await download(
  cobbleverse.downloadUrl,
  path.join(cacheRoot, `cobbleverse-${cobbleverse.version}.mrpack`),
  {
    size: cobbleverse.size,
    sha1: cobbleverse.sha1,
    sha512: cobbleverse.sha512,
  },
);
const cobblemonFile = await download(
  lock.sources.cobblemon.archiveUrl,
  path.join(cacheRoot, `cobblemon-${lock.sources.cobblemon.tag}.zip`),
);

const [
  pokedexSource,
  movesSource,
  learnsetsSource,
  abilitiesSource,
  itemsSource,
  typeChartSource,
  smogon9Source,
  smogon7Source,
  cobblemonDirectory,
  mrpack,
] = await Promise.all([
  fetchJson(lock.sources.showdown.pokedexUrl),
  fetchJson(lock.sources.showdown.movesUrl),
  fetchJson(lock.sources.showdown.learnsetsUrl),
  fetchText(lock.sources.showdown.abilitiesUrl),
  fetchText(lock.sources.showdown.itemsUrl),
  fetchText(lock.sources.showdown.typeChartUrl),
  fetchJson(lock.sources.smogon.generationSetsUrls[0]),
  fetchJson(lock.sources.smogon.generationSetsUrls[1]),
  openZip(cobblemonFile),
  readMrpack(mrpackFile),
]);
const pokedex = pokedexSource.data;
const rawMoves = movesSource.data;
const learnsets = learnsetsSource.data;
const rawAbilities = parseShowdownExport(
  abilitiesSource.raw,
  "BattleAbilities",
);
const rawItems = parseShowdownExport(itemsSource.raw, "BattleItems");
const typeChart = normalizeTypeChart(typeChartSource.raw);

const cobblemonDocuments = await jsonDocumentsFromDirectory(
  cobblemonDirectory,
  "species-legality",
  cobblemonFile,
);
const dependencyDocuments = await inspectPackDependencies(mrpack.index);
const packDocuments = [...mrpack.documents, ...dependencyDocuments];
const rejected = [
  ...[...cobblemonDocuments, ...packDocuments]
    .filter((document) => document.kind === "rejected-json")
    .map((document) => ({
      source: document.path,
      reason: document.error,
    })),
];

const moves = normalizeShowdownMoves(
  rawMoves,
  lock.sources.showdown.movesUrl,
);
const abilities = normalizeAbilityRecords(
  rawAbilities,
  lock.sources.showdown.abilitiesUrl,
);
const items = normalizeItemRecords(
  rawItems,
  lock.sources.showdown.itemsUrl,
);
const species = normalizeSpecies({
  cobblemonDocuments: cobblemonDocuments.filter((document) =>
    ["species", "species-addition"].includes(document.kind),
  ),
  overlayDocuments: packDocuments.filter((document) =>
    ["species", "species-addition"].includes(document.kind),
  ),
  showdownPokedex: pokedex,
  showdownLearnsets: learnsets,
  rejected,
});
const importedBuilds = [
  ...normalizeSmogonBuilds({
    rawSets: smogon9Source.data,
    species,
    moves,
    abilities,
    items,
    sourceUrl: lock.sources.smogon.generationSetsUrls[0],
    rejected,
  }),
  ...normalizeSmogonBuilds({
    rawSets: smogon7Source.data,
    species,
    moves,
    abilities,
    items,
    sourceUrl: lock.sources.smogon.generationSetsUrls[1],
    rejected,
  }),
].sort((left, right) => left.id.localeCompare(right.id));
const builds = [
  ...importedBuilds,
  ...deriveMissingBuilds({
    species,
    moves,
    abilities,
    items,
    importedBuilds,
    rejected,
  }),
].sort((left, right) => left.id.localeCompare(right.id));
const validationFailures = validateCatalog({
  species,
  moves,
  abilities,
  items,
  builds,
});
if (validationFailures.length > 0) {
  throw new Error(
    `Normalized catalog failed validation:\n${validationFailures
      .slice(0, 50)
      .join("\n")}`,
  );
}

const spawnDocuments = [...cobblemonDocuments, ...packDocuments].filter(
  (document) => document.kind === "spawn",
);
const availability = deriveAvailability(species, spawnDocuments);
const roles = deriveRoles(species, builds);
const generatedAt = new Date().toISOString();
const sources = [
  {
    name: "Cobbleverse",
    version: cobbleverse.version,
    url: cobbleverse.downloadUrl,
    checksumAlgorithm: "sha512",
    checksum: cobbleverse.sha512,
    authority: "pack-legality",
  },
  {
    name: "Cobblemon",
    version: lock.sources.cobblemon.tag,
    url: lock.sources.cobblemon.archiveUrl,
    checksumAlgorithm: "sha256",
    checksum: await checksum(cobblemonFile, "sha256"),
    authority: "species-legality",
  },
  ...[
    [
      "Pokemon Showdown Pokedex",
      lock.sources.showdown.pokedexUrl,
      "mechanics",
      pokedexSource.sha256,
    ],
    [
      "Pokemon Showdown Moves",
      lock.sources.showdown.movesUrl,
      "mechanics",
      movesSource.sha256,
    ],
    [
      "Pokemon Showdown Learnsets",
      lock.sources.showdown.learnsetsUrl,
      "mechanics",
      learnsetsSource.sha256,
    ],
    [
      "Pokemon Showdown Abilities",
      lock.sources.showdown.abilitiesUrl,
      "mechanics",
      abilitiesSource.sha256,
    ],
    [
      "Pokemon Showdown Items",
      lock.sources.showdown.itemsUrl,
      "mechanics",
      itemsSource.sha256,
    ],
    [
      "Pokemon Showdown Type Chart",
      lock.sources.showdown.typeChartUrl,
      "mechanics",
      typeChartSource.sha256,
    ],
    [
      "Smogon generation 9 sets",
      lock.sources.smogon.generationSetsUrls[0],
      "recommendation",
      smogon9Source.sha256,
    ],
    [
      "Smogon generation 7 sets",
      lock.sources.smogon.generationSetsUrls[1],
      "recommendation",
      smogon7Source.sha256,
    ],
  ].map(([name, url, authority, sourceChecksum]) => ({
    name,
    version: generatedAt.slice(0, 10),
    url,
    checksumAlgorithm: "sha256",
    checksum: sourceChecksum,
    authority,
  })),
];
const manifest = {
  schemaVersion: 1,
  dataVersion: lock.dataVersion,
  engineVersion: ENGINE_VERSION,
  generatedAt,
  speciesCount: species.length,
  moveCount: moves.length,
  abilityCount: abilities.length,
  itemCount: items.length,
  buildCount: builds.length,
  finalEvolutionCount: species.filter((record) => record.finalEvolution).length,
  starterCount: species.filter(
    (record) => record.finalEvolution && record.starter,
  ).length,
  megaCapableCount: species.filter(
    (record) => record.megaFormIds.length > 0,
  ).length,
  rejectedCount: rejected.length,
  dependencyScan: scanDependencies ? "all-manifest-archives" : "overrides-only",
  sources,
  rejected,
};

await Promise.all([
  writeGenerated("manifest.json", manifest),
  writeGenerated("species.json", species),
  writeGenerated("moves.json", moves),
  writeGenerated("abilities.json", abilities),
  writeGenerated("items.json", items),
  writeGenerated("builds.json", builds),
  writeGenerated("roles.json", roles),
  writeGenerated("availability.json", availability),
  writeGenerated("type-chart.json", typeChart),
  writeFile(
    path.join(reportRoot, "provenance.json"),
    stableJson({ manifest, scannedArchiveCount: mrpack.index.files.length }),
    "utf8",
  ),
]);

console.log(
  `Generated ${species.length} species, ${moves.length} moves, ${builds.length} validated builds.`,
);
