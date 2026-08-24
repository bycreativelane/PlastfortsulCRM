import { describe, expect, it } from "vitest";
import {
  broadcastStatusConfig,
  getBroadcastStatus,
  getRecipientStatus,
  recipientStatusConfig,
} from "./broadcast-status";

describe("getBroadcastStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getBroadcastStatus("sending")).toBe(broadcastStatusConfig.sending);
    expect(getBroadcastStatus("sent")).toBe(broadcastStatusConfig.sent);
    expect(getBroadcastStatus("failed")).toBe(broadcastStatusConfig.failed);
  });

  it("flags `sending` as the live state", () => {
    expect(getBroadcastStatus("sending").live).toBe(true);
    expect(getBroadcastStatus("sent").live).toBeFalsy();
  });

  it("falls back to draft on an unknown status string", () => {
    expect(getBroadcastStatus("not-a-real-status")).toBe(
      broadcastStatusConfig.draft,
    );
    expect(getBroadcastStatus("")).toBe(broadcastStatusConfig.draft);
  });

  it("speaks only in doctrine variants, never in raw palette classes", () => {
    // The old assertion here required a `bg-*/10 + text-* + border-*/20`
    // triple on every status, which is exactly how "enviando" ended up
    // amber-on-white at 2.75:1. Statuses name a meaning now; the badge
    // owns the colour.
    const allowed = new Set(["neutral", "auto", "ok", "danger"]);
    for (const v of [
      ...Object.values(broadcastStatusConfig),
      ...Object.values(recipientStatusConfig),
    ]) {
      expect(allowed.has(v.variant)).toBe(true);
      expect(v).not.toHaveProperty("classes");
    }
  });
});

describe("getRecipientStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getRecipientStatus("delivered")).toBe(
      recipientStatusConfig.delivered,
    );
    expect(getRecipientStatus("read")).toBe(recipientStatusConfig.read);
  });

  it("falls back to pending on an unknown status string", () => {
    expect(getRecipientStatus("???")).toBe(recipientStatusConfig.pending);
  });
});
