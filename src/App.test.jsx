import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

    const staffCodeInput = screen.getByLabelText("Staff Code");
    staffCodeInput.focus();
    expect(staffCodeInput).toHaveFocus();
    fireEvent.change(staffCodeInput, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(staffCodeInput).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
    expect(screen.getByText("Enter your staff code.")).toBeInTheDocument();
  });

  it("lets a manager add a manual punch for a missed shift", () => {
    localStorage.setItem("grocery-timecard-v1", JSON.stringify({
      staff: [{ id: "staff-a", name: "Aさん", wage: 20, code: "12345" }],
      shifts: [{ id: "shift-a", date: "2026-08-27", staffId: "staff-a", start: 600, end: 960 }],
      punches: [],
      storeName: "Sakura Mart",
      shiftNotes: {},
      adminPasscode: "1968",
      today: "2026-08-27",
    }));
    vi.setSystemTime(new Date("2026-08-28T17:00:00.000Z"));

    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "Manager" })[0]);
    const passcodeDialog = screen.getByRole("dialog");
    fireEvent.change(within(passcodeDialog).getByLabelText("パスコード"), { target: { value: "1968" } });
    fireEvent.click(within(passcodeDialog).getByRole("button", { name: "開く" }));

    fireEvent.click(screen.getAllByRole("button", { name: "勤務記録を追加" })[0]);
    const punchDialog = screen.getByRole("dialog");
    fireEvent.change(within(punchDialog).getByLabelText("スタッフ"), { target: { value: "staff-a" } });
    const dateInputs = punchDialog.querySelectorAll('input[type="date"]');
    const timeInputs = punchDialog.querySelectorAll("select.time-select");
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-27" } });
    fireEvent.change(timeInputs[0], { target: { value: "10:00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-27" } });
    fireEvent.change(timeInputs[1], { target: { value: "16:00" } });
    const submitted = Object.fromEntries(new FormData(punchDialog.querySelector("form")).entries());
    expect(submitted).toEqual({
      staffId: "staff-a",
      startDate: "2026-08-27",
      startTime: "10:00",
      endDate: "2026-08-27",
      endTime: "16:00",
    });
    fireEvent.click(within(punchDialog).getByRole("button", { name: "追加" }));

    const punchList = document.getElementById("punchList");
    expect(punchList?.textContent).toContain("Aさん");
    expect(punchList?.textContent).toContain("2026-08-27 10:00");
    expect(punchList?.textContent).toContain("2026-08-27 16:00");
  });
});
