import { describe, expect, it } from "vitest";

import {
  decodeSharePayload,
  encodeSharePayload,
  toCurrentGeneratorRequest,
} from "@/lib/share";
import type { SharePayload } from "@/lib/types";

describe("shared team compatibility", () => {
  it("preserves a legacy snapshot while upgrading its editable request", async () => {
    const legacyPayload = {
      schemaVersion: 1,
      request: {
        schemaVersion: 1,
        dataVersion: "cobbleverse-1.7.41b",
        engineVersion: 1,
        seed: "LEGACY-SEED",
        style: "balanced",
        availability: "journey",
        allowSpecial: false,
        requireMega: false,
        slots: [null, null, null, null, null, null],
      },
      result: {
        members: Array.from({ length: 6 }, (_, index) => ({ id: `${index}` })),
        provenance: { engineVersion: 1 },
      },
    } as unknown as SharePayload;

    const decoded = await decodeSharePayload(
      await encodeSharePayload(legacyPayload),
    );

    expect(Number(decoded.request.engineVersion)).toBe(1);
    expect(Number(decoded.result.provenance.engineVersion)).toBe(1);
    expect(decoded.result.battleQuality?.team).toBeUndefined();
    expect(decoded.result.members[0].jobs).toBeUndefined();
    expect(toCurrentGeneratorRequest(decoded.request).engineVersion).toBe(3);
  });
});
