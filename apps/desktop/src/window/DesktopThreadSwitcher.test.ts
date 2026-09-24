import { describe, expect, it, vi } from "vite-plus/test";
import type * as Electron from "electron";
import {
  isDesktopThreadSwitcherForwardInput,
  makeDesktopThreadSwitcherInputController,
} from "./DesktopThreadSwitcher.ts";

function input(overrides: Partial<Electron.Input>): Electron.Input {
  return {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: true,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides,
  };
}

describe("desktop thread switcher input", () => {
  it("dispatches forward, backward, commit, and cancel gestures", () => {
    const dispatch = vi.fn();
    const preventDefault = vi.fn();
    const controller = makeDesktopThreadSwitcherInputController(dispatch);
    const event = { preventDefault } as unknown as Electron.Event;

    controller.beforeInput(event, input({}));
    controller.beforeInput(event, input({ shift: true, isAutoRepeat: true }));
    controller.beforeInput(event, input({ type: "keyUp", key: "Control", control: false }));
    controller.beforeInput(event, input({}));
    controller.beforeInput(event, input({ key: "Escape", control: true }));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      "advance-forward",
      "advance-backward",
      "commit",
      "advance-forward",
      "cancel",
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(5);
    expect(controller.isActive()).toBe(false);
  });

  it("commits on blur only while active and ignores unrelated input", () => {
    const dispatch = vi.fn();
    const preventDefault = vi.fn();
    const controller = makeDesktopThreadSwitcherInputController(dispatch);
    const event = { preventDefault } as unknown as Electron.Event;

    controller.onBlur();
    controller.beforeInput(event, input({ key: "Tab", control: false }));
    controller.beforeInput(event, input({ key: "Tab", control: true, alt: true }));
    expect(dispatch).not.toHaveBeenCalled();

    controller.beforeInput(event, input({}));
    controller.onBlur();
    controller.onBlur();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(["advance-forward", "commit"]);
  });

  it("identifies preview inputs that must be forwarded to the main renderer", () => {
    expect(isDesktopThreadSwitcherForwardInput(input({}))).toBe(true);
    expect(
      isDesktopThreadSwitcherForwardInput(input({ type: "keyUp", key: "Control", control: false })),
    ).toBe(false);
    expect(
      isDesktopThreadSwitcherForwardInput(
        input({ type: "keyUp", key: "Control", control: false }),
        true,
      ),
    ).toBe(true);
    expect(isDesktopThreadSwitcherForwardInput(input({ key: "Escape" }), true)).toBe(true);
    expect(isDesktopThreadSwitcherForwardInput(input({ key: "Escape" }), false)).toBe(false);
    expect(isDesktopThreadSwitcherForwardInput(input({ shift: true }))).toBe(true);
    expect(isDesktopThreadSwitcherForwardInput(input({ alt: true }))).toBe(false);
    expect(isDesktopThreadSwitcherForwardInput(input({ key: "A" }))).toBe(false);
  });
});
