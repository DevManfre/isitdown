import { act, render, screen } from "@testing-library/react";
import { createHashRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall } from "@/lib/viewMemory.ts";
import { useViewParam } from "./useViewParam.ts";

type State = "all" | "active" | "resolved";
const parse = (raw: string): State | null => (raw === "all" || raw === "active" || raw === "resolved" ? raw : null);

function Probe() {
  const [state, setState] = useViewParam<State>("incidents", "state", "all", parse);
  return (
    <div>
      <span data-testid="value">{state}</span>
      <button onClick={() => setState("active")}>active</button>
      <button onClick={() => setState("all")}>all</button>
    </div>
  );
}

const mount = (hash = "/") => {
  window.location.hash = hash;
  return render(<RouterProvider router={createHashRouter([{ path: "/", element: <Probe /> }])} />);
};
const value = () => screen.getByTestId("value").textContent;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "/";
});
afterEach(() => localStorage.clear());

describe("useViewParam", () => {
  it("starts on the default when neither the address nor the memory says anything", () => {
    mount();
    expect(value()).toBe("all");
    expect(window.location.hash).toBe("#/");
  });

  it("writes a choice into the address and into the memory", () => {
    mount();
    act(() => screen.getByText("active").click());
    expect(value()).toBe("active");
    expect(window.location.hash).toBe("#/?state=active");
    expect(recall("incidents")).toEqual({ state: "active" });
  });

  it("takes the choice back out of both when it returns to the default", () => {
    mount();
    act(() => screen.getByText("active").click());
    act(() => screen.getByText("all").click());
    expect(window.location.hash).toBe("#/");
    expect(recall("incidents")).toEqual({});
  });

  it("reopens on what the browser last left, and puts it in the address", () => {
    localStorage.setItem("isitdown.views", JSON.stringify({ incidents: { state: "resolved" } }));
    mount();
    expect(value()).toBe("resolved");
    expect(window.location.hash).toBe("#/?state=resolved");
  });

  it("prefers the address to the memory, because the address is what was just clicked", () => {
    localStorage.setItem("isitdown.views", JSON.stringify({ incidents: { state: "resolved" } }));
    mount("/?state=active");
    expect(value()).toBe("active");
    expect(window.location.hash).toBe("#/?state=active");
  });

  it("ignores a value it has no control for, in the address and in the memory alike", () => {
    localStorage.setItem("isitdown.views", JSON.stringify({ incidents: { state: "bogus" } }));
    mount("/?state=nonsense");
    expect(value()).toBe("all");
  });

  it("survives storage that is corrupt", () => {
    localStorage.setItem("isitdown.views", "{not json");
    mount();
    expect(value()).toBe("all");
    act(() => screen.getByText("active").click());
    expect(value()).toBe("active");
  });

  it("leaves the rest of the address alone", () => {
    mount("/?from=overview&provider=github");
    act(() => screen.getByText("active").click());
    const hash = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(hash.get("from")).toBe("overview");
    expect(hash.get("provider")).toBe("github");
    expect(hash.get("state")).toBe("active");
  });
});
