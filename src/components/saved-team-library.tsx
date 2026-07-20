"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Heading } from "@astryxdesign/core/Heading";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import NextLink from "next/link";
import { useEffect, useMemo, useState } from "react";

import { encodeSharePayload, makeSharePayload } from "@/lib/share";
import {
  deleteSavedTeam,
  duplicateSavedTeam,
  readSavedTeams,
  renameSavedTeam,
} from "@/lib/storage";
import type { SavedTeam } from "@/lib/types";
import styles from "./saved-team-library.module.css";

type DialogState =
  | { kind: "rename"; team: SavedTeam }
  | { kind: "delete"; team: SavedTeam }
  | null;

export function SavedTeamLibrary() {
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");

  const refresh = () => setTeams(readSavedTeams());

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openTeam = async (team: SavedTeam) => {
    const payload = await encodeSharePayload(
      makeSharePayload(team.request, team.result),
    );
    window.location.assign(`/?team=${payload}`);
  };

  const displayedTeams = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return teams
      .filter(
        (team) =>
          !normalized ||
          team.name.toLowerCase().includes(normalized) ||
          team.request.seed.toLowerCase().includes(normalized) ||
          team.result.members.some((member) =>
            member.name.toLowerCase().includes(normalized),
          ),
      )
      .sort((left, right) =>
        sort === "score"
          ? right.result.score.total - left.result.score.total
          : right.updatedAt.localeCompare(left.updatedAt),
      );
  }, [query, sort, teams]);

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <Heading level={1} type="display-2">
          Saved teams
        </Heading>
        <Text type="large" color="secondary">
          Your teams stay on this device.
        </Text>
      </section>

      <HStack gap={3} wrap="wrap" vAlign="end">
        <TextInput
          label="Search saved teams"
          isLabelHidden
          placeholder="Search saved teams"
          value={query}
          startIcon={<Search />}
          hasClear
          width={300}
          onChange={setQuery}
        />
        <Selector
          label="Sort saved teams"
          isLabelHidden
          value={sort}
          width={220}
          options={[
            { value: "updated", label: "Recently updated" },
            { value: "score", label: "Highest score" },
          ]}
          onChange={setSort}
        />
        <Text type="supporting" color="secondary">
          {displayedTeams.length} {displayedTeams.length === 1 ? "team" : "teams"}
        </Text>
        <StackItem size="fill" />
        <NextLink href="/" className={styles.forgeLink}>
          <Sparkles aria-hidden="true" />
          Forge a new team
        </NextLink>
      </HStack>

      {teams.length === 0 ? (
        <Card padding={6} variant="muted">
          <VStack gap={3}>
            <Heading level={2}>No teams saved yet</Heading>
            <Text type="body" color="secondary">
              Generate a team, then use Save to keep its exact seed, settings,
              builds, and score snapshot here.
            </Text>
          </VStack>
        </Card>
      ) : (
        <VStack gap={3}>
          {displayedTeams.map((team) => (
            <Card key={team.id} padding={4}>
              <HStack gap={5} vAlign="center" wrap="wrap">
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center">
                    <Pencil aria-hidden="true" />
                    <Heading level={2}>{team.name}</Heading>
                  </HStack>
                  <HStack gap={4} wrap="wrap">
                    <VStack gap={0.5}>
                      <Text type="supporting" color="secondary">
                        SEED
                      </Text>
                      <Text type="label">{team.request.seed}</Text>
                    </VStack>
                    <VStack gap={0.5}>
                      <Text type="supporting" color="secondary">
                        STYLE
                      </Text>
                      <Text type="label">{team.request.style}</Text>
                    </VStack>
                    <VStack gap={0.5}>
                      <Text type="supporting" color="secondary">
                        AVAILABILITY
                      </Text>
                      <Text type="label">{team.request.availability}</Text>
                    </VStack>
                    <VStack gap={0.5}>
                      <Text type="supporting" color="secondary">
                        SCORE
                      </Text>
                      <Text type="label" weight="bold">
                        {team.result.score.total}
                      </Text>
                    </VStack>
                  </HStack>
                  <Text type="supporting" color="secondary">
                    Updated {new Date(team.updatedAt).toLocaleDateString()}
                  </Text>
                </VStack>
                <StackItem size="fill" />

                <ol className={styles.roster}>
                  {team.result.members.map((member) => (
                    <li key={member.id}>
                      <figure className={styles.rosterArt}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={member.artwork || member.spriteFallback}
                          alt={member.name}
                          loading="lazy"
                        />
                      </figure>
                      <Text type="supporting" maxLines={1}>
                        {member.name}
                      </Text>
                    </li>
                  ))}
                </ol>

                <HStack gap={2}>
                  <Button
                    label="Open"
                    variant="primary"
                    icon={<ExternalLink />}
                    onClick={() => void openTeam(team)}
                  />
                  <DropdownMenu
                    hasChevron={false}
                    menuWidth={180}
                    button={{
                      label: `Actions for ${team.name}`,
                      icon: <MoreHorizontal />,
                      isIconOnly: true,
                      variant: "secondary",
                      tooltip: `Actions for ${team.name}`,
                    }}
                    items={[
                      {
                        label: "Rename",
                        icon: <Pencil />,
                        onClick: () => {
                          setName(team.name);
                          setDialog({ kind: "rename", team });
                        },
                      },
                      {
                        label: "Duplicate",
                        icon: <Copy />,
                        onClick: () => {
                          duplicateSavedTeam(team.id);
                          refresh();
                        },
                      },
                      { type: "divider" },
                      {
                        label: "Delete",
                        icon: <Trash2 />,
                        onClick: () => setDialog({ kind: "delete", team }),
                      },
                    ]}
                  />
                </HStack>
              </HStack>
            </Card>
          ))}
        </VStack>
      )}

      <Dialog
        isOpen={dialog?.kind === "rename"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        width={440}
        purpose="form"
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title="Rename saved team"
              subtitle="The exact team snapshot will not change."
              onOpenChange={() => setDialog(null)}
            />
          }
          content={
            <LayoutContent>
              <TextInput
                label="Team name"
                value={name}
                hasAutoFocus
                width="100%"
                onChange={setName}
                onEnter={() => {
                  if (dialog?.kind !== "rename") return;
                  renameSavedTeam(dialog.team.id, name);
                  refresh();
                  setDialog(null);
                }}
              />
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} hAlign="end">
                <Button
                  label="Cancel"
                  variant="secondary"
                  onClick={() => setDialog(null)}
                />
                <Button
                  label="Save name"
                  variant="primary"
                  onClick={() => {
                    if (dialog?.kind !== "rename") return;
                    renameSavedTeam(dialog.team.id, name);
                    refresh();
                    setDialog(null);
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      <Dialog
        isOpen={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        width={440}
        purpose="required"
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title="Delete saved team?"
              subtitle={
                dialog?.kind === "delete"
                  ? `“${dialog.team.name}” will be removed from this browser.`
                  : undefined
              }
            />
          }
          content={
            <LayoutContent>
              <Text type="body">
                This cannot be undone unless you still have a shared link or
                exported build.
              </Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} hAlign="end">
                <Button
                  label="Keep team"
                  variant="secondary"
                  onClick={() => setDialog(null)}
                />
                <Button
                  label="Delete team"
                  variant="destructive"
                  onClick={() => {
                    if (dialog?.kind !== "delete") return;
                    deleteSavedTeam(dialog.team.id);
                    refresh();
                    setDialog(null);
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
