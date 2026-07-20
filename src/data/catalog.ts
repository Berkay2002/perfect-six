import abilities from "@/data/generated/abilities.json";
import availability from "@/data/generated/availability.json";
import builds from "@/data/generated/builds.json";
import items from "@/data/generated/items.json";
import manifest from "@/data/generated/manifest.json";
import moves from "@/data/generated/moves.json";
import roles from "@/data/generated/roles.json";
import species from "@/data/generated/species.json";
import typeChart from "@/data/generated/type-chart.json";
import type { NormalizedCatalog } from "@/lib/types";

export const catalog = {
  manifest,
  species,
  moves,
  abilities,
  items,
  builds,
  roles,
  availability,
  typeChart,
} as unknown as NormalizedCatalog;
