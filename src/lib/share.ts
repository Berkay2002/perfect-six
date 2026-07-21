import {
  ENGINE_VERSION,
  type GeneratorRequest,
  type SharePayload,
  type TeamResult,
} from "@/lib/types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(payload: string) {
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function transform(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
) {
  const writer = stream.writable.getWriter();
  const chunk = new Uint8Array(input.byteLength);
  chunk.set(input);
  await writer.write(chunk);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export function toCurrentGeneratorRequest(
  request: GeneratorRequest,
): GeneratorRequest {
  return { ...request, engineVersion: ENGINE_VERSION };
}

export async function encodeSharePayload(payload: SharePayload) {
  const encoded = textEncoder.encode(JSON.stringify(payload));
  const compressed = await transform(
    encoded,
    new CompressionStream("deflate-raw"),
  );
  return bytesToBase64Url(compressed);
}

export async function decodeSharePayload(payload: string) {
  const compressed = base64UrlToBytes(payload);
  const decoded = await transform(
    compressed,
    new DecompressionStream("deflate-raw"),
  );
  const parsed: unknown = JSON.parse(textDecoder.decode(decoded));
  if (!isSharePayload(parsed)) {
    throw new Error("Shared team payload is invalid or unsupported.");
  }
  return parsed;
}

function isSharePayload(value: unknown): value is SharePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SharePayload>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.request?.schemaVersion === 1 &&
    candidate.result?.members?.length === 6
  );
}

export function humanReadableTeam(result: TeamResult) {
  return result.members
    .map((member, index) => {
      const moves = member.build.moves
        .map((move) => `  • ${move.name} — ${move.purpose}`)
        .join("\n");
      return `${index + 1}. ${member.name}${member.mega ? " (Mega)" : ""}
Role: ${member.selectedRole}
Ability: ${member.build.ability}
Item: ${member.build.heldItem}
Nature: ${member.build.nature}
Moves:
${moves}
Plan: ${member.gamePlan}`;
    })
    .join("\n\n");
}

export function showdownTeam(result: TeamResult) {
  return result.members
    .map((member) => {
      const evs = [
        ["HP", member.build.evs.hp],
        ["Atk", member.build.evs.attack],
        ["Def", member.build.evs.defense],
        ["SpA", member.build.evs.specialAttack],
        ["SpD", member.build.evs.specialDefense],
        ["Spe", member.build.evs.speed],
      ]
        .filter(([, value]) => Number(value) > 0)
        .map(([label, value]) => `${value} ${label}`)
        .join(" / ");
      return `${member.name} @ ${member.build.heldItem}
Ability: ${member.build.ability}
EVs: ${evs || "Unspecified"}
${member.build.nature} Nature
${member.build.moves.map((move) => `- ${move.name}`).join("\n")}`;
    })
    .join("\n\n");
}

export function makeSharePayload(
  request: GeneratorRequest,
  result: TeamResult,
): SharePayload {
  return { schemaVersion: 1, request, result };
}
