"use client";

import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Moon, Sun } from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { useColorMode } from "@/components/app-providers";
import styles from "./app-header.module.css";

export function AppHeader() {
  const pathname = usePathname();
  const { mode, setMode } = useColorMode();

  return (
    <header className={styles.header}>
      <HStack gap={3} vAlign="center">
        <NextLink href="/" className={styles.brand}>
          <Text type="large" weight="bold">
            Perfect Six
          </Text>
        </NextLink>
        <StackItem size="fill" />
        <nav aria-label="Primary navigation">
          <HStack gap={3} vAlign="center">
            <Link
              as={NextLink}
              href="/"
              isStandalone
              hasUnderline={pathname === "/"}
            >
              Generator
            </Link>
            <Link
              as={NextLink}
              href="/saved"
              isStandalone
              hasUnderline={pathname === "/saved"}
            >
              Saved teams
            </Link>
            <Text
              className={styles.version}
              type="supporting"
              color="secondary"
            >
              Cobbleverse 1.7.41b
            </Text>
            <IconButton
              label={`Use ${mode === "light" ? "dark" : "light"} theme`}
              tooltip={`Use ${mode === "light" ? "dark" : "light"} theme`}
              variant="ghost"
              icon={mode === "light" ? <Moon /> : <Sun />}
              onClick={() => setMode(mode === "light" ? "dark" : "light")}
            />
          </HStack>
        </nav>
      </HStack>
    </header>
  );
}
