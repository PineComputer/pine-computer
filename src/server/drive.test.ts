import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { drive, toDriveAction, toKey } = await import("./drive");
type Session = Parameters<typeof drive>[0];

describe("toDriveAction", () => {
  it("relays an action Pine carries out as it is", () => {
    expect(toDriveAction({ action: "left_click", coordinate: [10, 20] })).toEqual({ action: "left_click", params: { coordinate: [10, 20] } });
    expect(toDriveAction({ action: "scroll", coordinate: [400, 300], scroll_direction: "down", scroll_amount: 3 })).toEqual({
      action: "scroll",
      params: { coordinate: [400, 300], scroll_direction: "down", scroll_amount: 3 },
    });
  });

  it("translates the fields that differ", () => {
    expect(toDriveAction({ action: "wait", duration: 2 })).toEqual({ action: "wait", params: { duration_ms: 2000 } });
    expect(toDriveAction({ action: "left_click_drag", start_coordinate: [1, 2], coordinate: [3, 4] })).toEqual({
      action: "left_click_drag",
      params: { coordinate: [1, 2], end_coordinate: [3, 4] },
    });
    expect(toDriveAction({ action: "key", text: "Return" })).toEqual({ action: "key", params: { text: "Enter" } });
  });

  it("refuses what Pine can't do, and a click with nowhere to click", () => {
    expect(toDriveAction({ action: "zoom", region: [0, 0, 1, 1] })).toHaveProperty("error");
    expect(toDriveAction({ action: "cursor_position" })).toHaveProperty("error");
    expect(toDriveAction({ action: "left_click" })).toHaveProperty("error");
    expect(toDriveAction({ action: "left_click", coordinate: [1, 1], text: "shift" })).toHaveProperty("error");
    expect(toDriveAction({ action: "scroll", scroll_direction: "down", scroll_amount: 2 })).toHaveProperty("error");
    expect(toDriveAction({ action: "key", text: "Page_Down" })).toHaveProperty("error");
  });
});

describe("toKey", () => {
  it("names keys and chords as the Computer does", () => {
    expect(toKey("Return")).toBe("Enter");
    expect(toKey("ctrl+a")).toBe("ctrl+a");
    expect(toKey("super+l")).toBe("cmd+l");
    expect(toKey("BackSpace")).toBe("Backspace");
    expect(toKey("Up")).toBe("ArrowUp");
    expect(toKey("Page_Down")).toBeNull();
    expect(toKey("hyper+a")).toBeNull();
  });
});

describe("drive", () => {
  it("carries out each action, answers with the screen, and stops when the model does", async () => {
    const computerUse = vi.fn(async (action: string) => ({ ok: true, screenshot: action === "screenshot" ? "U0hPVA==" : "" }));
    const screenshot = vi.fn(async () => ({ ok: true, screenshot: "QUZURVI=" }));
    const session = { drive: { computerUse, screenshot } } as unknown as Session;
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", input: { action: "left_click", coordinate: [5, 6] } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Clicked it." }] },
    ];
    const seen: unknown[][] = [];
    const model = vi.fn(async (messages: { role: string; content: unknown }[]) => {
      seen.push(structuredClone(messages));
      return replies.shift()!;
    });
    const steps: { type: string }[] = [];

    await drive(session, "Click the button", model, (step) => steps.push(step), new AbortController().signal);

    expect(computerUse).toHaveBeenCalledWith("left_click", { coordinate: [5, 6] }, expect.anything());
    // The click changed the screen: the next call carries the fresh screenshot.
    const results = seen[1].at(-1) as { content: { type: string; tool_use_id: string; content: { type: string; source?: { data: string } }[] }[] };
    expect(results.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(results.content[0].content[0].source?.data).toBe("QUZURVI=");
    expect(steps.map((s) => s.type)).toEqual(["action", "screen", "said", "done"]);
  });

  it("answers an unsupported action with an error instead of running it", async () => {
    const computerUse = vi.fn();
    const session = { drive: { computerUse, screenshot: vi.fn() } } as unknown as Session;
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", input: { action: "hold_key", text: "shift", duration: 1 } }] },
      { stop_reason: "end_turn", content: [] },
    ];
    const seen: unknown[][] = [];
    await drive(
      session,
      "Hold shift",
      async (messages) => (seen.push(structuredClone(messages)), replies.shift()!),
      () => undefined,
      new AbortController().signal,
    );
    expect(computerUse).not.toHaveBeenCalled();
    expect((seen[1].at(-1) as { content: { is_error?: boolean }[] }).content[0].is_error).toBe(true);
  });
});
