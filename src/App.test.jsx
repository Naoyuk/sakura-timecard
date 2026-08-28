import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("returns to a neutral screen after sign in", () => {
    localStorage.setItem("grocery-timecard-v1", JSON.stringify({
      staff: [{ id: "staff-a", name: "Aさん", wage: 20, code: "12345" }],
      shifts: [{ id: "shift-a", date: "2026-08-27", staffId: "staff-a", start: 600, end: 960 }],
      punches: [],
      storeName: "Sakura Mart",
      shiftNotes: {},
      adminPasscode: "1968",
      today: "2026-08-27",
    }));
    vi.setSystemTime(new Date("2026-08-27T17:00:00.000Z"));

    render(<App />);

    fireEvent.change(screen.getByLabelText("Staff Code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
    expect(screen.getByText("Enter your staff code.")).toBeInTheDocument();
  });
});
