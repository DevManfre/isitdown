import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { BusyProvider, useBusy, useBusyControls, useFieldProps } from "./useBusy.tsx";

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

/** A field that can be unmounted out from under its own focus. */
function Field() {
  const fieldProps = useFieldProps();
  return <input aria-label="field" {...fieldProps} />;
}

function Host() {
  const [mounted, setMounted] = useState(true);
  const busy = useBusy();
  return (
    <div>
      <span data-testid="busy">{String(busy)}</span>
      {mounted && <Field />}
      <button onClick={() => setMounted(false)}>unmount</button>
    </div>
  );
}

describe("useFieldProps", () => {
  const mount = () =>
    render(
      <BusyProvider>
        <Host />
      </BusyProvider>,
    );

  it("holds the poll while the field has focus and releases it on blur", () => {
    mount();
    const field = screen.getByLabelText("field");
    act(() => field.focus());
    expect(busyText()).toBe("true");
    act(() => field.blur());
    expect(busyText()).toBe("false");
  });

  // The path a blur handler cannot cover. An unmount runs no `onBlur`, so a
  // field that is still focused when its component goes away — browser-back, a
  // programmatic navigation, a route change — used to strand `editing: true`
  // and hold the 30s poll for the rest of the session. Two of the three
  // fieldProps copies this hook replaced had no cleanup at all.
  it("releases the poll when a focused field is unmounted without ever blurring", () => {
    mount();
    act(() => screen.getByLabelText("field").focus());
    expect(busyText()).toBe("true");

    act(() => screen.getByText("unmount").click());

    expect(screen.queryByLabelText("field")).toBeNull();
    expect(busyText()).toBe("false");
  });
});
