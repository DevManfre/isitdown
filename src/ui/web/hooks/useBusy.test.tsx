import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusyProvider, useBusy, useBusyControls } from "./useBusy.tsx";

function Probe() {
  const busy = useBusy();
  const { setDialogOpen, setEditing } = useBusyControls();
  return (
    <div>
      <span data-testid="busy">{String(busy)}</span>
      <button onClick={() => setDialogOpen(true)}>open</button>
      <button onClick={() => setEditing(true)}>edit</button>
      <button
        onClick={() => {
          setDialogOpen(false);
          setEditing(false);
        }}
      >
        idle
      </button>
    </div>
  );
}

const busyText = () => screen.getByTestId("busy").textContent;

describe("BusyProvider", () => {
  it("starts idle", () => {
    render(
      <BusyProvider>
        <Probe />
      </BusyProvider>,
    );
    expect(busyText()).toBe("false");
  });

  it("is busy while a dialog is open", () => {
    render(
      <BusyProvider>
        <Probe />
      </BusyProvider>,
    );
    act(() => screen.getByText("open").click());
    expect(busyText()).toBe("true");
  });

  it("is busy while a field is being edited", () => {
    render(
      <BusyProvider>
        <Probe />
      </BusyProvider>,
    );
    act(() => screen.getByText("edit").click());
    expect(busyText()).toBe("true");
  });

  it("goes idle again once both are released", () => {
    render(
      <BusyProvider>
        <Probe />
      </BusyProvider>,
    );
    act(() => screen.getByText("open").click());
    act(() => screen.getByText("idle").click());
    expect(busyText()).toBe("false");
  });
});
