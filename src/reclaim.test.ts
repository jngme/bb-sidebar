import { describe, expect, it } from "vitest";
import {
  describeReclaim,
  planTerminalReclaim,
  type ReclaimTerminal,
} from "./reclaim";

function terminal(overrides: Partial<ReclaimTerminal> = {}): ReclaimTerminal {
  return {
    id: "term_1",
    lastUserInputAt: null,
    status: "running",
    ...overrides,
  };
}

describe("planTerminalReclaim", () => {
  it("closes only the terminals nobody typed in", () => {
    expect(
      planTerminalReclaim([
        terminal({ id: "term_untouched" }),
        terminal({ id: "term_used", lastUserInputAt: 1 }),
      ]),
    ).toEqual({ close: ["term_untouched"], keep: 1 });
  });

  it("ignores terminals that are already gone", () => {
    expect(
      planTerminalReclaim([
        terminal({ id: "term_exited", status: "exited" }),
        terminal({ id: "term_disconnected", status: "disconnected" }),
      ]),
    ).toEqual({ close: [], keep: 0 });
  });

  it("counts a starting terminal as live", () => {
    expect(
      planTerminalReclaim([
        terminal({ id: "term_starting", status: "starting", lastUserInputAt: 1 }),
      ]),
    ).toEqual({ close: [], keep: 1 });
  });

  it("closes every live terminal when told to close them all", () => {
    expect(
      planTerminalReclaim(
        [
          terminal({ id: "term_untouched" }),
          terminal({ id: "term_used", lastUserInputAt: 1 }),
          terminal({ id: "term_exited", status: "exited", lastUserInputAt: 1 }),
        ],
        "all",
      ),
    ).toEqual({ close: ["term_untouched", "term_used"], keep: 0 });
  });

  it("plans nothing for a thread with no terminals", () => {
    expect(planTerminalReclaim([])).toEqual({ close: [], keep: 0 });
  });
});

describe("describeReclaim", () => {
  it("says nothing when settling released nothing", () => {
    expect(
      describeReclaim({
        closedTerminals: 0,
        keptTerminals: 0,
        stoppedRuntime: false,
        stoppedPorts: 0,
      }),
    ).toBeUndefined();
  });

  it("reports the runtime alone when there were no terminals", () => {
    expect(
      describeReclaim({
        closedTerminals: 0,
        keptTerminals: 0,
        stoppedRuntime: true,
        stoppedPorts: 0,
      }),
    ).toBe("Agent session stopped");
  });

  it("names what was closed and what was left", () => {
    expect(
      describeReclaim({
        closedTerminals: 1,
        keptTerminals: 2,
        stoppedRuntime: true,
        stoppedPorts: 0,
      }),
    ).toBe(
      "Agent session stopped · closed 1 terminal · 2 terminals left running",
    );
  });

  it("names the ports whose processes a settle stopped", () => {
    expect(
      describeReclaim({
        closedTerminals: 2,
        keptTerminals: 0,
        stoppedRuntime: true,
        stoppedPorts: 1,
      }),
    ).toBe("Agent session stopped · closed 2 terminals · stopped processes on 1 port");
  });

  it("warns about surviving terminals even when nothing was closed", () => {
    expect(
      describeReclaim({
        closedTerminals: 0,
        keptTerminals: 1,
        stoppedRuntime: false,
        stoppedPorts: 0,
      }),
    ).toBe("1 terminal left running");
  });
});
