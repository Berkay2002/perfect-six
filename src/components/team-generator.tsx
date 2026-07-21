"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
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
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import speciesData from "@/data/generated/species.json";
import { evolutionNeedsGender } from "@/engine/evolution";
import { useTeamWorker } from "@/hooks/use-team-worker";
import { randomDisplaySeed } from "@/lib/random";
import { ownedSlotsForRequest } from "@/lib/request";
import {
  alternativeQualitySummary,
  alternativeTradeoffPresentation,
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
  type TeamRecommendation,
  type TeamResult,
} from "@/lib/types";
import styles from "./team-generator.module.css";

type SpeciesItem = SearchableItem<{
  starter: boolean;
  types: string[];
}>;

const species = (speciesData as unknown as SpeciesRecord[])
  .filter((entry) => !entry.battleOnly)
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
const speciesRecordById = new Map(species.map((entry) => [entry.id, entry]));

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
  ownedSlots: [null, null, null, null, null, null],
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
const genderOptions = [
  { value: "unknown", label: "Choose gender" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

const evStatLabels = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  specialAttack: "Sp. Atk",
  specialDefense: "Sp. Def",
  speed: "Speed",
} satisfies Record<keyof TeamMember["build"]["evs"], string>;

function formatEvSpread(evs: TeamMember["build"]["evs"]) {
  return (
    Object.entries(evs)
      .filter(([, value]) => value > 0)
      .map(
        ([stat, value]) =>
          `${value} ${evStatLabels[stat as keyof typeof evStatLabels]}`,
      )
      .join(" · ") || "Source set has no EV allocation"
  );
}

function formatIvTargets(ivs: TeamMember["build"]["ivs"]) {
  const targets = {
    hp: 31,
    attack: 31,
    defense: 31,
    specialAttack: 31,
    specialDefense: 31,
    speed: 31,
    ...ivs,
  };
  return Object.entries(targets)
    .map(
      ([stat, value]) =>
        `${value} ${evStatLabels[stat as keyof typeof evStatLabels]}`,
    )
    .join(" · ");
}

function ExpandableText({ children }: { children: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <VStack gap={2}>
      <Text
        type="supporting"
        color="secondary"
        maxLines={isExpanded ? 0 : 3}
        hasTruncateTooltip={false}
        textWrap="pretty"
      >
        {children}
      </Text>
      <Button
        label={isExpanded ? "Show less" : "Read more"}
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      />
    </VStack>
  );
}

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
  onAlternatives,
  alternativesBusy,
  canFindAlternatives,
}: {
  member: TeamMember;
  selected: boolean;
  onSelect: () => void;
  onAlternatives: () => void;
  alternativesBusy: boolean;
  canFindAlternatives: boolean;
}) {
  return (
    <ClickableCard
      label={`View ${member.name} details`}
      className={`${styles.memberTile} ${selected ? styles.memberTileSelected : ""}`}
      onClick={onSelect}
      padding={0}
    >
      <PokemonArt member={member} compact />
      {canFindAlternatives ? (
        <Button
          className={styles.tileAlternativeAction}
          label="Find alternatives"
          aria-label={`Find alternatives for ${member.name}`}
          variant="secondary"
          size="sm"
          icon={<Shuffle />}
          isLoading={alternativesBusy}
          onClick={onAlternatives}
        />
      ) : null}
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
    </ClickableCard>
  );
}

function MemberDetail({
  member,
  onAlternatives,
  alternativesBusy,
  canFindAlternatives,
}: {
  member: TeamMember;
  onAlternatives: () => void;
  alternativesBusy: boolean;
  canFindAlternatives: boolean;
}) {
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <HStack gap={4} vAlign="center" wrap="wrap">
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
          {canFindAlternatives ? (
            <Button
              label="Find alternatives"
              variant="secondary"
              icon={<Shuffle />}
              isLoading={alternativesBusy}
              onClick={onAlternatives}
            />
          ) : null}
        </HStack>
        <Divider />
        <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={4}>
          <VStack gap={3}>
            <Heading level={3}>Ideal build</Heading>
            <MetadataList columns="multi" label={{ position: "top" }}>
              <MetadataListItem label="Ability">
                {member.build.ability}
              </MetadataListItem>
              <MetadataListItem label="Held item">
                {member.build.heldItem}
              </MetadataListItem>
              <MetadataListItem label="Nature">
                {member.build.nature}
              </MetadataListItem>
              <MetadataListItem label="EV spread">
                {formatEvSpread(member.build.evs)}
              </MetadataListItem>
              <MetadataListItem label="IV targets">
                {formatIvTargets(member.build.ivs)}
              </MetadataListItem>
              <MetadataListItem label="Build confidence">
                {member.buildConfidence ?? "Legacy snapshot"}
              </MetadataListItem>
            </MetadataList>
            <VStack gap={2}>
              <Text type="supporting" color="secondary">
                Moves
              </Text>
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
            <MetadataList label={{ position: "top" }}>
              <MetadataListItem label="Origin">
                {member.origin ?? "Legacy snapshot"}
              </MetadataListItem>
              <MetadataListItem label="Planned evolution">
                {member.evolutionPath?.length
                  ? member.evolutionPath
                      .map(
                        (id) => speciesRecordById.get(id)?.name ?? id,
                      )
                      .join(" → ")
                  : member.availability.evolutionLine}
              </MetadataListItem>
              <MetadataListItem label="Battle role">
                {member.selectedRole}
              </MetadataListItem>
              <MetadataListItem label="Game plan">
                {member.gamePlan}
              </MetadataListItem>
              <MetadataListItem label="Team jobs">
                {member.jobExplanation ??
                  "This saved team predates team-job explanations."}
              </MetadataListItem>
              <MetadataListItem label="Acquisition">
                {member.availability.guidance}
              </MetadataListItem>
              <MetadataListItem label="Practical substitute">
                {member.build.practicalSubstitute}
              </MetadataListItem>
            </MetadataList>
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

function AlternativeCard({
  alternative,
  onApply,
}: {
  alternative: TeamAlternative;
  onApply: (alternative: TeamAlternative) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const tradeoff = alternativeTradeoffPresentation(alternative.tradeoff);

  return (
    <Card padding={3} variant="muted">
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
        <Text type="body" textWrap="pretty">
          {tradeoff.summary}
        </Text>
        <Collapsible
          trigger={isExpanded ? "Show less" : "Read more"}
          isOpen={isExpanded}
          onOpenChange={setIsExpanded}
        >
          <VStack gap={3}>
            {tradeoff.sections.map((section) => (
              <VStack key={section.label} gap={1}>
                <Text type="label" weight="semibold">
                  {section.label}
                </Text>
                <Text
                  type="supporting"
                  color="secondary"
                  textWrap="pretty"
                >
                  {section.explanation}
                </Text>
              </VStack>
            ))}
          </VStack>
        </Collapsible>
        <Button
          label={`Use ${alternative.replacement.name}`}
          variant="secondary"
          onClick={() => onApply(alternative)}
        />
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
            <AlternativeCard
              key={alternative.kind}
              alternative={alternative}
              onApply={onApply}
            />
          ))}
        </Grid>
      </VStack>
    </section>
  );
}

function RecommendationRow({
  recommendation,
  onReview,
}: {
  recommendation: TeamRecommendation;
  onReview: (recommendation: TeamRecommendation) => void;
}) {
  return (
    <ListItem
      label={recommendation.label}
      startContent={
        <Badge
          variant={recommendation.kind === "coordinated" ? "purple" : "teal"}
          label={recommendation.kind === "coordinated" ? "Plan" : "Single swap"}
        />
      }
      endContent={
        <Button
          label="Review change"
          variant="secondary"
          onClick={() => onReview(recommendation)}
        />
      }
      description={
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            {recommendation.scoreDelta >= 0 ? "+" : ""}
            {recommendation.scoreDelta} team score
          </Text>
        <MetadataList label={{ position: "start" }}>
          {recommendation.changes.map((change) => (
            <MetadataListItem
              key={change.slot}
              label={`Slot ${change.slot + 1}`}
            >
              {change.from.name} → {change.to.name}
            </MetadataListItem>
          ))}
          <MetadataListItem label="Closed gaps">
            {recommendation.closedGaps.join(", ") || "None"}
          </MetadataListItem>
          <MetadataListItem label="Tradeoff">
            {recommendation.tradeoffs.join(" ")}
          </MetadataListItem>
        </MetadataList>
        </VStack>
      }
    />
  );
}

function RecommendationSection({
  recommendations,
  isLoading,
  onReview,
}: {
  recommendations: TeamRecommendation[];
  isLoading: boolean;
  onReview: (recommendation: TeamRecommendation) => void;
}) {
  if (!isLoading && recommendations.length === 0) return null;
  return (
    <section aria-labelledby="recommendations-heading">
      <VStack gap={3}>
        <VStack gap={1}>
          <Heading id="recommendations-heading" level={2}>
            Possible improvements
          </Heading>
          <Text type="body" color="secondary">
            Your entered party stays primary. These optional changes are scored
            after its evaluation.
          </Text>
        </VStack>
        {isLoading ? (
          <ProgressBar label="Checking roster improvements" isIndeterminate />
        ) : (
          <List
            density="spacious"
            hasDividers
            header={<Text type="label">Ranked optional changes</Text>}
          >
            {recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.id}
                recommendation={recommendation}
                onReview={onReview}
              />
            ))}
          </List>
        )}
      </VStack>
    </section>
  );
}

export function TeamGenerator() {
  const {
    generate,
    alternatives: loadAlternatives,
    recommendations: loadRecommendations,
    busy,
  } = useTeamWorker();
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<TeamResult | null>(null);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [alternatives, setAlternatives] = useState<TeamAlternative[]>([]);
  const [alternativesBusy, setAlternativesBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<TeamRecommendation[]>([]);
  const [recommendationsBusy, setRecommendationsBusy] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] =
    useState<TeamRecommendation | null>(null);
  const [undoResult, setUndoResult] = useState<TeamResult | null>(null);
  const recommendationRunRef = useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const qualityPresentation = result
    ? battleQualityPresentation(result)
    : null;
  const requestOwnedSlots = ownedSlotsForRequest(request);
  const existingAdventure = requestOwnedSlots.some(Boolean);

  const runGenerate = useCallback(
    async (nextRequest: GeneratorRequest) => {
      setError("");
      setNotice("");
      setAlternatives([]);
      setRecommendations([]);
      setRecommendationsBusy(false);
      setUndoResult(null);
      const recommendationRun = recommendationRunRef.current + 1;
      recommendationRunRef.current = recommendationRun;
      const missingGender = ownedSlotsForRequest(nextRequest).find(
        (slot) =>
          slot &&
          evolutionNeedsGender(slot.speciesId, { species }) &&
          !slot.evolutionFacts?.gender,
      );
      if (missingGender) {
        setError(
          `Choose a gender for ${speciesRecordById.get(missingGender.speciesId)?.name ?? missingGender.speciesId} so its legal evolution branches can be evaluated.`,
        );
        return;
      }
      try {
        const nextResult = await generate(nextRequest);
        setRequest(nextRequest);
        setResult(nextResult);
        setSelectedSlot(0);
        const ownedCount = ownedSlotsForRequest(nextRequest).filter(Boolean).length;
        if (ownedCount >= 4) {
          setRecommendationsBusy(true);
          void loadRecommendations(nextRequest, nextResult)
            .then((nextRecommendations) => {
              if (recommendationRunRef.current === recommendationRun) {
                setRecommendations(nextRecommendations);
              }
            })
            .catch(() => {
              if (recommendationRunRef.current === recommendationRun) {
                setRecommendations([]);
              }
            })
            .finally(() => {
              if (recommendationRunRef.current === recommendationRun) {
                setRecommendationsBusy(false);
              }
            });
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Generation failed.");
      }
    },
    [generate, loadRecommendations],
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
  const selectedItems = requestOwnedSlots.map((slot) =>
    slot ? speciesById.get(slot.speciesId) ?? null : null,
  );

  const updateSlot = (index: number, item: SpeciesItem | null) => {
    setRequest((current) => {
      const ownedSlots = [...ownedSlotsForRequest(current)] as NonNullable<
        GeneratorRequest["ownedSlots"]
      >;
      const slots = [...current.slots] as GeneratorRequest["slots"];
      slots[index] = item?.id ?? null;
      ownedSlots[index] = item ? { speciesId: item.id } : null;
      return { ...current, ownedSlots, slots };
    });
  };

  const updateGender = (index: number, gender: string) => {
    setRequest((current) => {
      const ownedSlots = [...ownedSlotsForRequest(current)] as NonNullable<
        GeneratorRequest["ownedSlots"]
      >;
      const slot = ownedSlots[index];
      if (!slot) return current;
      ownedSlots[index] = {
        ...slot,
        evolutionFacts:
          gender === "female" || gender === "male" ? { gender } : undefined,
      };
      return { ...current, ownedSlots };
    });
  };

  const showAlternatives = async (slot = selectedSlot) => {
    if (!result) return;
    setSelectedSlot(slot);
    setAlternatives([]);
    setAlternativesBusy(true);
    setError("");
    try {
      setAlternatives(
        await loadAlternatives(slot, request, result),
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
    setRequest((current) => ({ ...current, ownedSlots: undefined, slots }));
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
            <Divider />
            <VStack gap={3}>
              <VStack gap={1}>
                <Heading level={2}>Pokémon I already have</Heading>
                <Text type="body" color="secondary">
                  Leave every slot empty to build from scratch. Add one to six
                  current Pokémon to plan their evolutions and complete the party
                  around them.
                </Text>
              </VStack>
              <Grid
                columns={{ minWidth: 230, max: 3, repeat: "fit" }}
                gap={3}
              >
                {selectedItems.map((item, index) => {
                  const owned = requestOwnedSlots[index];
                  const needsGender = owned
                    ? evolutionNeedsGender(owned.speciesId, { species })
                    : false;
                  return (
                    <VStack key={index} gap={2}>
                      <Typeahead
                        label={`Owned slot ${index + 1}`}
                        placeholder="Search any Pokémon or form…"
                        description="Enter the species and form you have now."
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
                      {needsGender ? (
                        <Selector
                          label={`Gender for slot ${index + 1}`}
                          options={genderOptions}
                          value={owned?.evolutionFacts?.gender ?? "unknown"}
                          width="100%"
                          onChange={(gender) => updateGender(index, gender)}
                        />
                      ) : null}
                    </VStack>
                  );
                })}
              </Grid>
            </VStack>
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
          <HStack gap={3} vAlign="center">
            <Text type="body">{notice}</Text>
            <StackItem size="fill" />
            {undoResult ? (
              <Button
                label="Undo recommendation"
                variant="secondary"
                icon={<Undo2 />}
                onClick={() => {
                  setResult(undoResult);
                  setUndoResult(null);
                  setNotice("Returned to your entered party evaluation.");
                }}
              />
            ) : null}
          </HStack>
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
                  {result.battleQuality?.weaknesses?.length ? (
                    <List
                      density="compact"
                      hasDividers
                      header={<Text type="label">Shared weaknesses</Text>}
                    >
                      {result.battleQuality.weaknesses.map((weakness) => (
                        <ListItem
                          key={weakness.attackType}
                          label={weakness.attackType}
                          description={`${weakness.weakMembers} members weak; ${weakness.protectedMembers} resist or ignore it.`}
                        />
                      ))}
                    </List>
                  ) : (
                    <Text type="supporting" color="secondary">
                      No attack type threatens two or more members.
                    </Text>
                  )}
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
                        <ExpandableText>{section.explanation}</ExpandableText>
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
                        key={`${index}:${member.id}`}
                        member={member}
                        selected={selectedSlot === index}
                        onSelect={() => {
                          setSelectedSlot(index);
                          setAlternatives([]);
                        }}
                        onAlternatives={() => void showAlternatives(index)}
                        alternativesBusy={
                          alternativesBusy && selectedSlot === index
                        }
                        canFindAlternatives={!existingAdventure}
                      />
                    ))}
                  </Grid>

                  {selectedMember ? (
                    <MemberDetail
                      member={selectedMember}
                      onAlternatives={() => void showAlternatives(selectedSlot)}
                      alternativesBusy={alternativesBusy}
                      canFindAlternatives={!existingAdventure}
                    />
                  ) : null}

                  <RecommendationSection
                    recommendations={recommendations}
                    isLoading={recommendationsBusy}
                    onReview={setPendingRecommendation}
                  />

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
      <Dialog
        isOpen={pendingRecommendation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRecommendation(null);
        }}
        width={520}
        purpose="required"
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title="Apply this roster recommendation?"
              subtitle="Your entered party evaluation remains available through Undo."
            />
          }
          content={
            <LayoutContent>
              <VStack gap={3}>
                <Text type="body">
                  The replacement members will be labeled as recommended, not
                  as Pokémon you entered.
                </Text>
                <MetadataList label={{ position: "start" }}>
                  {pendingRecommendation?.changes.map((change) => (
                    <MetadataListItem
                      key={change.slot}
                      label={`Slot ${change.slot + 1}`}
                    >
                      {change.from.name} → {change.to.name}
                    </MetadataListItem>
                  ))}
                </MetadataList>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} hAlign="end">
                <Button
                  label="Keep entered party"
                  variant="secondary"
                  onClick={() => setPendingRecommendation(null)}
                />
                <Button
                  label="Apply recommendation"
                  variant="primary"
                  onClick={() => {
                    if (!pendingRecommendation || !result) return;
                    setUndoResult(result);
                    setResult(pendingRecommendation.preview);
                    setRecommendations([]);
                    setNotice(
                      "Recommendation applied. Replacements are labeled recommended.",
                    );
                    setPendingRecommendation(null);
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </main>
  );
}
