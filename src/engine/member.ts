import type { PokemonRecord, TeamMember } from "@/lib/types";

export function pokemonRecordFromMember(member: TeamMember): PokemonRecord {
  const {
    slot,
    selectedRole,
    mega,
    gamePlan,
    jobs,
    jobExplanation,
    origin,
    enteredSpeciesId,
    selectedEvolutionId,
    evolutionPath,
    buildConfidence,
    ...pokemon
  } = member;
  void slot;
  void selectedRole;
  void mega;
  void gamePlan;
  void jobs;
  void jobExplanation;
  void origin;
  void enteredSpeciesId;
  void selectedEvolutionId;
  void evolutionPath;
  void buildConfidence;
  return pokemon;
}
