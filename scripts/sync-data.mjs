import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  normalizeNamedRecords,
  normalizeShowdownMoves,
  normalizeSmogonBuilds,
  normalizeSpecies,
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
  const response = await fetch(url, {
    headers: { "User-Agent": "perfect-six-data-pipeline/1" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  if (!(await verifyExpected(temporary, expected))) {
    await rm(temporary, { force: true });
    throw new Error(`Checksum or size mismatch for ${url}`);
  }
  await rename(temporary, destination);
  return destination;
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
  const spawnText = spawnDocuments.map((document) => ({
    path: document.path,
    text: JSON.stringify(document.data).toLowerCase(),
  }));
  return species.map((pokemon) => {
    const evidence = spawnText
      .filter(({ text }) => text.includes(pokemon.id))
      .slice(0, 5)
      .map(({ path: sourcePath }) => ({
        kind: "spawn",
        sourcePath,
        summary: "Species identifier appears in sourced spawn definition.",
      }));
    const score = evidence.length > 0 ? 70 : 35;
    return {
      speciesId: pokemon.id,
      difficulty: evidence.length > 0 ? "Moderate" : "Late game",
      stage: evidence.length > 0 ? "Mid" : "Late",
      evolutionLine: pokemon.preEvolutionId
        ? `Evolves from ${pokemon.preEvolutionId}`
        : pokemon.evolutions.length
          ? `Evolves into ${pokemon.evolutions.map((entry) => entry.targetId).join(", ")}`
          : "Final evolution",
      guidance:
        evidence.length > 0
          ? "See sourced spawn evidence."
          : "No verified spawn rule found in scanned snapshot.",
      score,
      evidence:
        evidence.length > 0
          ? evidence
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
  smogon9Source,
  smogon7Source,
  cobblemonDirectory,
  mrpack,
] = await Promise.all([
  fetchJson(lock.sources.showdown.pokedexUrl),
  fetchJson(lock.sources.showdown.movesUrl),
  fetchJson(lock.sources.showdown.learnsetsUrl),
  fetchJson(lock.sources.showdown.abilitiesUrl),
  fetchJson(lock.sources.showdown.itemsUrl),
  fetchJson(lock.sources.smogon.generationSetsUrls[0]),
  fetchJson(lock.sources.smogon.generationSetsUrls[1]),
  openZip(cobblemonFile),
  readMrpack(mrpackFile),
]);
const pokedex = pokedexSource.data;
const rawMoves = movesSource.data;
const learnsets = learnsetsSource.data;
const rawAbilities = abilitiesSource.data;
const rawItems = itemsSource.data;

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
const abilities = normalizeNamedRecords(
  rawAbilities,
  lock.sources.showdown.abilitiesUrl,
);
const items = normalizeNamedRecords(
  rawItems,
  lock.sources.showdown.itemsUrl,
);
const species = normalizeSpecies({
  cobblemonDocuments: cobblemonDocuments.filter(
    (document) => document.kind === "species",
  ),
  overlayDocuments: packDocuments.filter((document) =>
    ["species", "species-addition"].includes(document.kind),
  ),
  showdownPokedex: pokedex,
  showdownLearnsets: learnsets,
  rejected,
});
const builds = [
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

const spawnDocuments = packDocuments.filter(
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
  engineVersion: 1,
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
  writeFile(
    path.join(reportRoot, "provenance.json"),
    stableJson({ manifest, scannedArchiveCount: mrpack.index.files.length }),
    "utf8",
  ),
]);

console.log(
  `Generated ${species.length} species, ${moves.length} moves, ${builds.length} validated builds.`,
);
