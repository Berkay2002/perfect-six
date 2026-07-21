"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  Typeahead,
  type SearchableItem,
  type SearchSource,
} from "@astryxdesign/core/Typeahead";
import {
  Clipboard,
  Dices,
  Download,
  RefreshCw,
  Save,
  Share2,
  Shuffle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import speciesData from "@/data/generated/species.json";
import { useTeamWorker } from "@/hooks/use-team-worker";
import { randomDisplaySeed } from "@/lib/random";
import {
  alternativeQualitySummary,
  battleQualityPresentation,
} from "@/lib/quality-presentation";
import {
  decodeSharePayload,
  encodeSharePayload,
  humanReadableTeam,
  makeSharePayload,
  showdownTeam,
  toCurrentGeneratorRequest,
} from "@/lib/share";
import { saveTeam } from "@/lib/storage";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
  type SpeciesRecord,
  type TeamAlternative,
  type TeamMember,
  type TeamResult,
} from "@/lib/types";
import styles from "./team-generator.module.css";

type SpeciesItem = SearchableItem<{
  starter: boolean;
  types: string[];
}>;

const species = (speciesData as unknown as SpeciesRecord[])
  .filter((entry) => entry.finalEvolution && !entry.battleOnly)
  .sort(
    (left, right) =>
      left.dexNumber - right.dexNumber || left.name.localeCompare(right.name),
  );

const speciesItems: SpeciesItem[] = species.map((entry) => ({
  id: entry.id,
  label: entry.name,
  auxiliaryData: { starter: entry.starter, types: [...entry.types] },
}));

const speciesById = new Map(speciesItems.map((entry) => [entry.id, entry]));

const speciesSource: SearchSource<SpeciesItem> = {
  search(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return speciesItems.slice(0, 18);
    return speciesItems
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(normalized) ||
          entry.id.includes(normalized) ||
          entry.auxiliaryData?.types.some((type) =>
            type.toLowerCase().includes(normalized),
          ),
      )
      .slice(0, 30);
  },
  bootstrap() {
    return [
      ...speciesItems.filter((entry) => entry.auxiliaryData?.starter).slice(0, 8),
      ...speciesItems.filter((entry) => !entry.auxiliaryData?.starter).slice(0, 10),
    ];
  },
};

const defaultRequest: GeneratorRequest = {
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed: "EMBER-042",
  style: "balanced",
  availability: "journey",
  allowSpecial: false,
  requireMega: false,
  slots: [null, null, null, null, null, null],
};

const styleOptions = [
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
  { value: "bulky", label: "Bulky" },
  { value: "weather", label: "Weather" },
  { value: "random", label: "Random" },
];
const weatherOptions = [
  { value: "random", label: "Random weather" },
  { value: "rain", label: "Rain" },
  { value: "sun", label: "Sun" },
  { value: "sand", label: "Sand" },
  { value: "snow", label: "Snow" },
];
const availabilityOptions = [
  { value: "journey", label: "Journey-friendly" },
  { value: "unrestricted", label: "Unrestricted" },
];

function ScoreMetric({ label, value }: { label: string; value: number }) {
  return (
    <VStack gap={1}>
      <HStack gap={2}>
        <Text type="supporting" color="secondary">
          {label}
        </Text>
        <StackItem size="fill" />
        <Text type="supporting" weight="semibold">
          {value}
        </Text>
      </HStack>
      <ProgressBar label={`${label}: ${value}`} value={value} isLabelHidden />
    </VStack>
  );
}

function PokemonArt({
  member,
  compact = false,
}: {
  member: TeamMember;
  compact?: boolean;
}) {
  return (
    <figure className={compact ? styles.artCompact : styles.art}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={member.artwork || member.spriteFallback}
        alt={`${member.name} artwork`}
        loading="lazy"
        onError={(event) => {
          const image = event.currentTarget;
          if (image.src !== member.spriteFallback) image.src = member.spriteFallback;
        }}
      />
    </figure>
  );
}

function MemberTile({
  member,
  selected,
  onSelect,
}: {
  member: TeamMember;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`${styles.memberTile} ${selected ? styles.memberTileSelected : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <PokemonArt member={member} compact />
      <span className={styles.tileOverlay}>
        <span className={styles.tileCopy}>
          <Text type="label" weight="bold" maxLines={1}>
            {member.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {member.selectedRole}
          </Text>
        </span>
        <span className={styles.typeRow}>
          {member.starter ? <Badge variant="orange" label="Starter" /> : null}
          {member.types.map((type) => (
            <Badge key={type} variant="green" label={type} />
          ))}
        </span>
      </span>
    </button>
  );
}

function MemberDetail({
  member,
  onAlternatives,
  alternativesBusy,
}: {
  member: TeamMember;
  onAlternatives: () => void;
  alternativesBusy: boolean;
}) {
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <HStack gap={4} vAlign="center">
          <PokemonArt member={member} />
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Heading level={2}>{member.name}</Heading>
              {member.starter ? <Badge variant="orange" label="Starter" /> : null}
              {member.mega ? <Badge variant="purple" label="Mega" /> : null}
            </HStack>
            <Text type="large" color="secondary">
              {member.selectedRole}
            </Text>
            <Text type="supporting" color="secondary">
              {member.availability.difficulty} · {member.availability.stage} game
            </Text>
          </VStack>
          <StackItem size="fill" />
          <Button
            label="Find alternatives"
            variant="secondary"
            icon={<Shuffle />}
            isLoading={alternativesBusy}
            onClick={onAlternatives}
          />
        </HStack>
        <Divider />
        <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={4}>
          <VStack gap={3}>
            <Heading level={3}>Ideal build</Heading>
            <Text type="body">
              <Text type="label" weight="semibold">
                Ability
              </Text>{" "}
              {member.build.ability}
            </Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Held item
              </Text>{" "}
              {member.build.heldItem}
            </Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Nature
              </Text>{" "}
              {member.build.nature}
            </Text>
            <Text type="supporting" color="secondary">
              EVs:{" "}
              {Object.entries(member.build.evs)
                .filter(([, value]) => value > 0)
                .map(([stat, value]) => `${value} ${stat}`)
                .join(" · ") || "Source set has no EV allocation"}
            </Text>
            <VStack gap={2}>
              {member.build.moves.map((move) => (
                <HStack key={move.id} gap={2} vAlign="center">
                  <Badge
                    variant={move.category === "Status" ? "teal" : "red"}
                    label={move.category}
                  />
                  <Text type="label" weight="semibold">
                    {move.name}
                  </Text>
                  <StackItem size="fill" />
                  <Text type="supporting" color="secondary">
                    {move.type}
                    {move.power ? ` · ${move.power}` : ""}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </VStack>
          <VStack gap={3}>
            <Heading level={3}>Field notes</Heading>
            <Text type="body">{member.gamePlan}</Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Team jobs
              </Text>{" "}
              {member.jobExplanation ??
                "This saved team predates team-job explanations."}
            </Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Evolution
              </Text>{" "}
              {member.availability.evolutionLine}
            </Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Acquisition
              </Text>{" "}
              {member.availability.guidance}
            </Text>
            <Text type="body">
              <Text type="label" weight="semibold">
                Practical substitute
              </Text>{" "}
              {member.build.practicalSubstitute}
            </Text>
            <Text type="supporting" color="secondary">
              Build basis: {member.build.source.kind} ·{" "}
              {member.build.source.format}
            </Text>
          </VStack>
        </Grid>
      </VStack>
    </Card>
  );
}

function AlternativeTray({
  alternatives,
  onApply,
}: {
  alternatives: TeamAlternative[];
  onApply: (alternative: TeamAlternative) => void;
}) {
  if (alternatives.length === 0) return null;
  return (
    <section aria-labelledby="alternative-heading">
      <VStack gap={3}>
        <Heading id="alternative-heading" level={2}>
          Three legal alternatives
        </Heading>
        <Grid columns={{ minWidth: 230, max: 3, repeat: "fit" }} gap={3}>
          {alternatives.map((alternative) => (
            <Card key={alternative.kind} padding={3} variant="muted">
              <VStack gap={3}>
                <HStack gap={3} vAlign="center">
                  <PokemonArt member={alternative.replacement} compact />
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary">
                      {alternative.label}
                    </Text>
                    <Heading level={3}>{alternative.replacement.name}</Heading>
                    <Text type="supporting" color="secondary">
                      {alternativeQualitySummary(alternative.scoreDelta)}
                    </Text>
                  </VStack>
                </HStack>
                <Text type="supporting">{alternative.tradeoff}</Text>
                <Button
                  label={`Use ${alternative.replacement.name}`}
                  variant="secondary"
                  onClick={() => onApply(alternative)}
                />
              </VStack>
            </Card>
          ))}
        </Grid>
      </VStack>
    </section>
  );
}

export function TeamGenerator() {
  const { generate, alternatives: loadAlternatives, busy } = useTeamWorker();
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<TeamResult | null>(null);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [alternatives, setAlternatives] = useState<TeamAlternative[]>([]);
  const [alternativesBusy, setAlternativesBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const qualityPresentation = result
    ? battleQualityPresentation(result)
    : null;

  const runGenerate = useCallback(
    async (nextRequest: GeneratorRequest) => {
      setError("");
      setNotice("");
      setAlternatives([]);
      try {
        const nextResult = await generate(nextRequest);
        setRequest(nextRequest);
        setResult(nextResult);
        setSelectedSlot(0);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Generation failed.");
      }
    },
    [generate],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const shared = new URLSearchParams(window.location.search).get("team");
      if (shared) {
        try {
          const payload = await decodeSharePayload(shared);
          if (!cancelled) {
            setRequest(toCurrentGeneratorRequest(payload.request));
            setResult(payload.result);
            setNotice("Shared team loaded from its exact snapshot.");
          }
          return;
        } catch {
          if (!cancelled) setError("The shared team link is invalid or damaged.");
        }
      }
      if (!cancelled) await runGenerate(defaultRequest);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [runGenerate]);

  const selectedMember = result?.members[selectedSlot] ?? null;
  const selectedItems = useMemo(
    () => request.slots.map((id) => (id ? speciesById.get(id) ?? null : null)),
    [request.slots],
  );

  const updateSlot = (index: number, item: SpeciesItem | null) => {
    setRequest((current) => {
      const slots = [...current.slots] as GeneratorRequest["slots"];
      slots[index] = item?.id ?? null;
      return { ...current, slots };
    });
  };

  const showAlternatives = async () => {
    if (!result) return;
    setAlternativesBusy(true);
    setError("");
    try {
      setAlternatives(
        await loadAlternatives(selectedSlot, request, result),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not find alternatives.",
      );
    } finally {
      setAlternativesBusy(false);
    }
  };

  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  };

  const copyShareLink = async () => {
    if (!result) return;
    const payload = await encodeSharePayload(makeSharePayload(request, result));
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("team", payload);
    await copy(url.toString(), "Exact deterministic team link copied.");
  };

  const applyAlternative = (alternative: TeamAlternative) => {
    const slots = [...request.slots] as GeneratorRequest["slots"];
    slots[selectedSlot] = alternative.replacement.id;
    setRequest((current) => ({ ...current, slots }));
    setResult(alternative.result);
    setAlternatives([]);
    setNotice(
      `${alternative.replacement.name} applied and fixed in slot ${selectedSlot + 1}.`,
    );
  };

  return (
    <main className={styles.page}>
      <section className={styles.controls} aria-label="Generator settings">
        <Card padding={3}>
          <VStack gap={3}>
            <Grid
              columns={{ minWidth: 150, max: 7, repeat: "fit" }}
              gap={3}
              align="end"
            >
              <TextInput
                label="Seed"
                value={request.seed}
                placeholder="EMBER-042"
                width="100%"
                onChange={(seed) =>
                  setRequest((current) => ({ ...current, seed }))
                }
                onEnter={() => void runGenerate(request)}
              />
              <Selector
                label="Style"
                options={styleOptions}
                value={request.style}
                width="100%"
                onChange={(style) =>
                  setRequest((current) => ({
                    ...current,
                    style: style as GeneratorRequest["style"],
                  }))
                }
              />
              {request.style === "weather" ? (
                <Selector
                  label="Weather"
                  options={weatherOptions}
                  value={request.weather ?? "random"}
                  width="100%"
                  onChange={(weather) =>
                    setRequest((current) => ({
                      ...current,
                      weather: weather as GeneratorRequest["weather"],
                    }))
                  }
                />
              ) : (
                <Selector
                  label="Availability"
                  options={availabilityOptions}
                  value={request.availability}
                  width="100%"
                  onChange={(availability) =>
                    setRequest((current) => ({
                      ...current,
                      availability:
                        availability as GeneratorRequest["availability"],
                    }))
                  }
                />
              )}
              <Switch
                label="Special class"
                labelTooltip="Allows at most one legendary, mythical, Ultra Beast, or paradox Pokémon."
                value={request.allowSpecial}
                onChange={(allowSpecial) =>
                  setRequest((current) => ({ ...current, allowSpecial }))
                }
                labelSpacing="spread"
              />
              <Switch
                label="Mega evolution"
                labelTooltip="Requires exactly one source-verified Mega-capable build."
                value={request.requireMega}
                onChange={(requireMega) =>
                  setRequest((current) => ({ ...current, requireMega }))
                }
                labelSpacing="spread"
              />
              <Button
                label="Forge my team"
                variant="primary"
                size="lg"
                icon={<RefreshCw />}
                isLoading={busy}
                onClick={() => void runGenerate(request)}
              />
              <Button
                label="Random seed"
                variant="secondary"
                icon={<Dices />}
                onClick={() =>
                  setRequest((current) => ({
                    ...current,
                    seed: randomDisplaySeed(),
                  }))
                }
              />
            </Grid>
            {request.style === "weather" ? (
              <Selector
                label="Availability"
                options={availabilityOptions}
                value={request.availability}
                width="100%"
                onChange={(availability) =>
                  setRequest((current) => ({
                    ...current,
                    availability:
                      availability as GeneratorRequest["availability"],
                  }))
                }
              />
            ) : null}
            <Collapsible
              defaultIsOpen={false}
              trigger={`Roster locks · ${request.slots.filter(Boolean).length} fixed`}
            >
              <Grid
                columns={{ minWidth: 230, max: 3, repeat: "fit" }}
                gap={3}
              >
                {selectedItems.map((item, index) => (
                  <Typeahead
                    key={index}
                    label={`Slot ${index + 1}`}
                    placeholder="Search final evolutions…"
                    searchSource={speciesSource}
                    value={item}
                    onChange={(value) => updateSlot(index, value)}
                    renderItem={(option) => (
                      <HStack gap={2}>
                        <Text type="label">{option.label}</Text>
                        <StackItem size="fill" />
                        {option.auxiliaryData?.starter ? (
                          <Badge variant="orange" label="Starter" />
                        ) : null}
                      </HStack>
                    )}
                    hasEntriesOnFocus
                    debounceMs={0}
                    size="sm"
                  />
                ))}
              </Grid>
            </Collapsible>
          </VStack>
        </Card>
      </section>

      {error ? (
        <Card variant="red" padding={3}>
          <Text type="body" weight="semibold">
            {error}
          </Text>
        </Card>
      ) : null}
      {notice ? (
        <Card variant="green" padding={3}>
          <Text type="body">{notice}</Text>
        </Card>
      ) : null}

      <Layout
        className={styles.resultLayout}
        height="auto"
        padding={0}
        end={
          result ? (
            <LayoutPanel
              width={370}
              padding={4}
              hasDivider
              isScrollable={false}
              role="complementary"
              label={alternatives.length > 0 ? "Alternatives" : "Team score"}
            >
              {alternatives.length > 0 ? (
                <AlternativeTray
                  alternatives={alternatives}
                  onApply={applyAlternative}
                />
              ) : (
                <VStack gap={4}>
                  {qualityPresentation?.state === "legacy" ? (
                    <Card variant="yellow" padding={3}>
                      <VStack gap={1}>
                        <Text type="label">{qualityPresentation.label}</Text>
                        <Text type="supporting">
                          {qualityPresentation.explanation}
                        </Text>
                      </VStack>
                    </Card>
                  ) : null}
                  <VStack gap={1}>
                    <Heading level={2}>Team score</Heading>
                    <Heading level={3} type="display-2">
                      {result.score.total}
                      <Text type="large" color="secondary">
                        {" "}
                        / 100
                      </Text>
                    </Heading>
                  </VStack>
                  <ScoreMetric
                    label="Role coverage"
                    value={result.score.roleCoverage}
                  />
                  <ScoreMetric
                    label="Defensive fit"
                    value={result.score.defensiveFit}
                  />
                  <ScoreMetric
                    label="Offensive reach"
                    value={result.score.offensiveReach}
                  />
                  <ScoreMetric
                    label="Journey fit"
                    value={result.score.journeyFit}
                  />
                  {qualityPresentation?.sections.map((section) => (
                    <Card key={section.label} variant="muted" padding={3}>
                      <VStack gap={1}>
                        <Text type="label">
                          {section.label} · {section.summary}
                        </Text>
                        <Text type="supporting" color="secondary">
                          {section.explanation}
                        </Text>
                      </VStack>
                    </Card>
                  ))}
                  {result.warnings.map((warning) => (
                    <Card key={warning.code} variant="yellow" padding={3}>
                      <Text type="body">{warning.message}</Text>
                    </Card>
                  ))}
                  <Divider />
                  <Button
                    label="Save team"
                    variant="primary"
                    icon={<Save />}
                    onClick={() => {
                      const saved = saveTeam(
                        `Team ${request.seed}`,
                        request,
                        result,
                      );
                      setNotice(`Saved as “${saved.name}”.`);
                    }}
                  />
                  <Button
                    label="Copy build"
                    variant="secondary"
                    icon={<Clipboard />}
                    onClick={() =>
                      void copy(
                        humanReadableTeam(result),
                        "Readable team copied.",
                      )
                    }
                  />
                  <Button
                    label="Copy Showdown"
                    variant="secondary"
                    icon={<Download />}
                    onClick={() =>
                      void copy(
                        showdownTeam(result),
                        "Showdown-compatible export copied.",
                      )
                    }
                  />
                  <Button
                    label="Share team"
                    variant="secondary"
                    icon={<Share2 />}
                    onClick={() => void copyShareLink()}
                  />
                </VStack>
              )}
            </LayoutPanel>
          ) : null
        }
        content={
          <LayoutContent padding={4} role="region" label="Generated team">
            <VStack gap={5}>
              {result ? (
                <>
                  <Grid
                    columns={{ minWidth: 220, max: 3, repeat: "fit" }}
                    gap={2}
                  >
                    {result.members.map((member, index) => (
                      <MemberTile
                        key={member.id}
                        member={member}
                        selected={selectedSlot === index}
                        onSelect={() => {
                          setSelectedSlot(index);
                          setAlternatives([]);
                        }}
                      />
                    ))}
                  </Grid>

                  {selectedMember ? (
                    <MemberDetail
                      member={selectedMember}
                      onAlternatives={() => void showAlternatives()}
                      alternativesBusy={alternativesBusy}
                    />
                  ) : null}

                </>
              ) : (
                <Card padding={6} variant="muted">
                  <VStack gap={3}>
                    <Heading level={2}>Consulting the field guide…</Heading>
                    <ProgressBar label="Generating team" isIndeterminate />
                  </VStack>
                </Card>
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </main>
  );
}
