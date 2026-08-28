const storeKey = "grocery-timecard-v1";
const APP_VERSION = "1.0.1";
const TIME_ZONE = "America/Vancouver";
const formatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  timeZone: TIME_ZONE,
});
const staffFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: TIME_ZONE,
});
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});
const zonedPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});
const zoneOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  timeZoneName: "shortOffset",
});

const state = loadState();
let adminUnlocked = false;
let activeStaffId = "";
const $ = (selector) => document.querySelector(selector);

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (saved) {
    const parsed = JSON.parse(saved);
    parsed.staff = staffWithCodes(parsed.staff || []);
    return {
      ...parsed,
      storeName: parsed.storeName || "Sakura Mart",
      shiftNotes: parsed.shiftNotes || {},
      adminPasscode: parsed.adminPasscode || "1968",
    };
  }

  const today = localDateKey(new Date());
  return {
    staff: staffWithCodes([
      { id: newId(), name: "Aさん", wage: 18.25 },
      { id: newId(), name: "Bさん", wage: 18.25 },
      { id: newId(), name: "Cさん", wage: 19.0 },
    ]),
    shifts: [],
    punches: [],
    storeName: "Sakura Mart",
    shiftNotes: {},
    adminPasscode: "1968",
    today,
  };
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function dateKey(date) {
  const parts = zonedParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateKey(date) {
  return dateKey(date);
}

function zonedParts(date) {
  return zonedPartsFormatter.formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function plainDateToUtcDate(value) {
  const { year, month, day } = parseDateKey(value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(dateValue, days) {
  const next = plainDateToUtcDate(dateValue);
  next.setUTCDate(next.getUTCDate() + days);
  return dateKeyFromUtcDate(next);
}

function mondayOf(dateValue) {
  const monday = plainDateToUtcDate(dateValue);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return dateKeyFromUtcDate(monday);
}

function weekDates() {
  const start = $("#shiftWeekStart").value;
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function getTimeZoneOffsetMinutes(date) {
  const label = zoneOffsetFormatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = label.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function staffWithCodes(staff) {
  const used = new Set(staff.map((person) => person.code).filter(Boolean));
  return staff.map((person) => {
    if (person.code) return person;
    const code = generateStaffCode(used);
    used.add(code);
    return { ...person, code };
  });
}

function generateStaffCode(used = new Set(state?.staff?.map((person) => person.code).filter(Boolean) || [])) {
  let code = "";
  do {
    code = String(Math.floor(10000 + Math.random() * 90000));
  } while (used.has(code));
  return code;
}

function minutesToTime(total) {
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function roundToQuarter(date) {
  const rounded = new Date(date);
  const minutes = dateToMinutes(rounded);
  const quarter = Math.round(minutes / 15) * 15;
  const dayOffset = Math.floor(quarter / (24 * 60));
  const normalized = ((quarter % (24 * 60)) + (24 * 60)) % (24 * 60);
  const roundedDateKey = addDays(dateKey(rounded), dayOffset);
  return dateTimeFromDateKeyAndMinutes(roundedDateKey, normalized);
}

function staffName(id) {
  return state.staff.find((person) => person.id === id)?.name || "未登録";
}

function currentStaffId() {
  return activeStaffId;
}

function openPunchFor(staffId) {
  return state.punches.find((punch) => punch.staffId === staffId && !punch.endAt);
}

function shiftPunch(shiftOrId) {
  const shift = typeof shiftOrId === "string"
    ? state.shifts.find((item) => item.id === shiftOrId)
    : shiftOrId;
  if (!shift) return undefined;

  const exact = state.punches.find((punch) => punch.shiftId === shift.id);
  if (exact) return exact;

  // Older device data may have an empty or stale shiftId. Match by the
  // scheduled staff, local date, and overlapping time as a fallback.
  const candidates = state.punches.filter((punch) => {
    const scheduledStaffId = punch.scheduledStaffId || punch.staffId;
    const pointsToKnownShift = punch.shiftId && state.shifts.some((item) => item.id === punch.shiftId);
    if (pointsToKnownShift && punch.shiftId !== shift.id) return false;
    if (scheduledStaffId !== shift.staffId || !punch.startAt) return false;
    const started = new Date(punch.startAt);
    if (Number.isNaN(started.getTime()) || localDateKey(started) !== shift.date) return false;
    return true;
  });
  const overlaps = candidates.filter((punch) => {
    const start = dateToMinutes(new Date(punch.startAt));
    const end = punch.endAt ? dateToMinutes(new Date(punch.endAt)) : start + 15;
    return end > shift.start && start < shift.end;
  });
  const matched = overlaps[0] || candidates
    .sort((a, b) => Math.abs(dateToMinutes(new Date(a.startAt)) - shift.start)
      - Math.abs(dateToMinutes(new Date(b.startAt)) - shift.start))[0];
  if (matched) matched.shiftId = shift.id;
  return matched;
}

function todaysShifts() {
  return state.shifts
    .filter((shift) => shift.date === localDateKey(new Date()))
    .sort((a, b) => a.start - b.start);
}

function render() {
  renderStoreName();
  renderHeader();
  renderStaffOptions();
  renderStaffView();
  renderAdminView();
  saveState();
}

function renderStoreName() {
  const storeName = state.storeName || "Sakura Mart";
  $("#storeNameHeading").textContent = storeName;
  document.title = `Timecard | ${storeName}`;
  const versionLabel = $("#appVersion");
  if (versionLabel) versionLabel.textContent = `Version ${APP_VERSION}`;
  const appleTitle = document.querySelector("meta[name='apple-mobile-web-app-title']");
  if (appleTitle) appleTitle.setAttribute("content", storeName);
  if ($("#storeNameInput")) $("#storeNameInput").value = storeName;
}

function renderHeader() {
  const now = new Date();
  $("#todayLabel").textContent = activeViewId() === "staffView" ? staffFormatter.format(now) : formatter.format(now);
  $("#clock").textContent = timeLabel(now);
}

function activeViewId() {
  return document.querySelector(".view.active")?.id || "staffView";
}

function switchView(viewId) {
  if (viewId !== "staffView") {
    activeStaffId = "";
    $("#staffCodeInput").value = "";
    $("#staffCodeError").classList.add("hidden");
  }
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((item) => {
    item.classList.toggle("active", item.id === viewId);
  });
  renderHeader();
}

function openPasscodeDialog() {
  $("#passcodeDialog").classList.remove("hidden");
  $("#passcodeError").classList.add("hidden");
  $("#adminPasscodeInput").value = "";
  $("#adminPasscodeInput").focus();
}

function closePasscodeDialog() {
  $("#passcodeDialog").classList.add("hidden");
}

function openSaveDialog() {
  $("#saveDialog").classList.remove("hidden");
}

function closeSaveDialog() {
  $("#saveDialog").classList.add("hidden");
}

function openShiftDialog(shiftId = "") {
  resetShiftForm();
  if (shiftId) {
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!shift) return;
    $("#shiftDialogTitle").textContent = "シフト変更";
    $("#shiftSubmitBtn").textContent = "Save";
    $("#shiftEditId").value = shift.id;
    $("#shiftDate").value = shift.date;
    $("#shiftStaff").value = shift.staffId;
    $("#shiftStart").value = minutesToTime(shift.start);
    $("#shiftEnd").value = minutesToTime(shift.end);
  }
  $("#shiftDialog").classList.remove("hidden");
}

function closeShiftDialog() {
  $("#shiftDialog").classList.add("hidden");
}

function resetShiftForm() {
  $("#shiftDialogTitle").textContent = "シフト追加";
  $("#shiftSubmitBtn").textContent = "追加";
  $("#shiftEditId").value = "";
  $("#shiftStart").value = "09:00";
  $("#shiftEnd").value = "17:00";
  $("#shiftDate").value = weekDates()[0];
}

function openStaffDialog(staffId = "") {
  resetStaffForm();
  if (staffId) editStaff(staffId);
  $("#staffDialog").classList.remove("hidden");
}

function closeStaffDialog() {
  $("#staffDialog").classList.add("hidden");
}

function openStaffCodeDialog(staffId) {
  const person = state.staff.find((item) => item.id === staffId);
  if (!person) return;
  $("#largeStaffName").textContent = person.name;
  $("#largeStaffCode").textContent = person.code;
  $("#staffCodeDialog").classList.remove("hidden");
}

function closeStaffCodeDialog() {
  $("#staffCodeDialog").classList.add("hidden");
}

function openPunchDialog(punchId) {
  const punch = state.punches.find((item) => item.id === punchId);
  if (!punch) return;
  const start = new Date(punch.startAt);
  const end = punch.endAt ? new Date(punch.endAt) : null;
  $("#punchEditId").value = punch.id;
  $("#punchStaffName").value = staffName(punch.staffId);
  $("#punchStartDate").value = localDateKey(start);
  $("#punchStartTime").value = timeLabel(start);
  $("#punchEndDate").value = end ? localDateKey(end) : "";
  $("#punchEndTime").value = end ? timeLabel(end) : "";
  $("#punchDialog").classList.remove("hidden");
}

function closePunchDialog() {
  $("#punchDialog").classList.add("hidden");
}

function renderWeekLabel() {
  const dates = weekDates();
  const start = dates[0];
  const end = dates[6];
  $("#shiftWeekLabel").textContent = `${weekDayLabel(start, "ja")} - ${weekDayLabel(end, "ja")}`;
}

function moveShiftWeek(days) {
  $("#shiftWeekStart").value = addDays($("#shiftWeekStart").value, days);
  render();
}

function renderStaffOptions() {
  const selectedPay = $("#payStaff").value;
  const selectedShiftDate = $("#shiftDate").value;
  const options = state.staff
    .map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`)
    .join("");
  $("#shiftStaff").innerHTML = options;
  $("#payStaff").innerHTML = `<option value="all">全員まとめて</option>${options}`;
  $("#shiftDate").innerHTML = weekDates()
    .map((date) => {
      return `<option value="${date}">${weekDayLabel(date, "ja")}</option>`;
    })
    .join("");
  if (selectedPay) $("#payStaff").value = selectedPay;
  if (selectedShiftDate) $("#shiftDate").value = selectedShiftDate;
  renderWeekLabel();
}

function populateTimeSelects() {
  document.querySelectorAll(".time-select").forEach((select) => {
    const current = select.value;
    const optional = !select.required;
    const options = [];
    if (optional) options.push(`<option value="">未入力</option>`);
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const value = minutesToTime(minutes);
      options.push(`<option value="${value}">${value}</option>`);
    }
    select.innerHTML = options.join("");
    if (current) select.value = current;
  });
}

function renderStaffView() {
  const staffId = currentStaffId();
  const person = state.staff.find((item) => item.id === staffId);
  const active = openPunchFor(staffId);
  const activeBox = $("#activePunch");
  const clockOutBtn = $("#clockOutBtn");
  const choices = $("#shiftChoices");

  $("#todayShifts").innerHTML = todaysShifts().length
    ? renderShiftTimeline(todaysShifts(), true, "en")
    : `<div class="empty">No shifts today.</div>`;

  if (!person) {
    activeBox.classList.add("hidden");
    clockOutBtn.classList.add("hidden");
    choices.innerHTML = `<div class="empty">Enter your staff code.</div>`;
    $("#staffCodeInput").disabled = false;
    return;
  }

  $("#staffCodeInput").disabled = false;
  if (active) {
    const start = new Date(active.startAt);
    activeBox.classList.remove("hidden");
    clockOutBtn.classList.remove("hidden");
    activeBox.innerHTML = `<span>${escapeHtml(staffName(active.staffId))} is signed in</span><span>Since ${timeLabel(start)}</span>`;
    choices.innerHTML = "";
  } else {
    activeBox.classList.add("hidden");
    clockOutBtn.classList.add("hidden");
    choices.innerHTML = signinChoices(staffId);
  }
}

function signinChoices(staffId) {
  const today = todaysShifts();
  const own = today.filter((shift) => shift.staffId === staffId && !shiftPunch(shift));
  const swaps = today.filter((shift) => shift.staffId !== staffId && !shiftPunch(shift));
  const cards = [];

  own.forEach((shift) => cards.push(renderSigninCard(shift, false)));
  swaps.forEach((shift) => cards.push(renderSigninCard(shift, true)));

  if (!cards.length) {
    cards.push(`
      <article class="shift-card">
        <strong>No available shift</strong>
        <div class="meta">You can sign in only for a scheduled shift or as coverage.</div>
      </article>
    `);
  }

  return cards.join("");
}

function renderSigninCard(shift, isSwap) {
  const assigned = staffName(shift.staffId);
  const title = isSwap ? `Cover ${assigned}'s shift` : "Your scheduled shift";
  const note = isSwap ? "This will be recorded as coverage." : "Sign in for your scheduled shift.";
  return `
    <article class="shift-card ${isSwap ? "swap" : ""}">
      <strong>${escapeHtml(title)}</strong>
      <div class="meta">${minutesToTime(shift.start)} - ${minutesToTime(shift.end)}</div>
      <div class="meta">${note}</div>
      <button data-action="clock-in" data-shift-id="${shift.id}">Sign In</button>
    </article>
  `;
}

function renderShiftRow(shift) {
  const punch = shiftPunch(shift);
  const locale = activeViewId() === "staffView" ? "en" : "ja";
  const actual = shiftCoverageLabel(shift, punch, locale);
  const bounds = timelineBounds([shift]);
  const style = timelineStyle(shift, bounds);
  return `
    <div class="timeline-row">
      <div class="timeline-person">
        <div class="title">${escapeHtml(staffName(shift.staffId))}</div>
        <div class="sub">${escapeHtml(actual)}</div>
      </div>
      <div class="timeline-track">
        <div class="timeline-block ${punch ? "worked" : ""}" style="${style}">
          <strong>${minutesToTime(shift.start)} - ${minutesToTime(shift.end)}</strong>
          <span>${shiftStatusLabel(punch, locale)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderShiftTimeline(shifts, showDate = true, locale = "ja") {
  if (!shifts.length) return `<div class="empty">${locale === "en" ? "No shifts." : "シフトはまだありません。"}</div>`;
  const sorted = [...shifts].sort((a, b) => `${a.date}-${a.start}`.localeCompare(`${b.date}-${b.start}`));
  const byDate = sorted.reduce((groups, shift) => {
    groups[shift.date] ||= [];
    groups[shift.date].push(shift);
    return groups;
  }, {});

  return Object.entries(byDate)
    .map(([date, dateShifts]) => {
      const bounds = timelineBounds(dateShifts, locale === "en");
      return `
        <section class="timeline-day">
          ${showDate ? `<div class="timeline-date">${escapeHtml(timelineDateLabel(date, locale))}</div>` : ""}
          <div class="timeline-scale">
            <span>${minutesToTime(bounds.start)}</span>
            <span>${minutesToTime(Math.floor((bounds.start + bounds.end) / 2))}</span>
            <span>${minutesToTime(bounds.end)}</span>
          </div>
          ${dateShifts
            .sort((a, b) => a.start - b.start)
            .map((shift) => renderTimelineShift(shift, bounds, locale))
            .join("")}
        </section>
      `;
    })
    .join("");
}

function renderWeeklyShifts() {
  const dates = weekDates().map(localDateKey);
  return `
    <div class="week-table">
      <div class="week-table-head">
        <div>日付</div>
        <div>名前・シフト</div>
        <div>備考</div>
      </div>
      ${dates.map(renderWeekTableRow).join("")}
    </div>
  `;
}

function renderWeekTableRow(date) {
  const shifts = state.shifts
    .filter((shift) => shift.date === date)
    .sort((a, b) => a.start - b.start);
  return `
    <div class="week-table-row">
      <div class="week-date">${escapeHtml(weekDayLabel(date, "ja"))}</div>
      <div class="week-shifts">
        <div class="compact-scale"><span>8</span><span>14</span><span>20</span></div>
        ${
          shifts.length
            ? shifts.map(renderCompactShift).join("")
            : `<div class="compact-empty">-</div>`
        }
      </div>
      <input class="week-note" data-action="shift-note" data-date="${date}" value="${escapeHtml(state.shiftNotes[date] || "")}" placeholder="祝日・イベント">
    </div>
  `;
}

function renderCompactShift(shift) {
  const punch = shiftPunch(shift);
  const actual = punch ? actualShiftTimes(punch) : null;
  return `
    <div class="compact-shift">
      <div class="compact-name">${escapeHtml(staffName(shift.staffId))}</div>
      <div class="compact-track stacked">
        <div class="compact-bar planned" style="${compactShiftStyle(shift)}"></div>
        ${actual ? `<div class="compact-bar actual" style="${compactShiftStyle(actual)}"></div>` : ""}
      </div>
      <div class="compact-time">
        <span>予定 ${minutesToTime(shift.start)}-${minutesToTime(shift.end)}</span>
        ${actual ? `<span>実績 ${minutesToTime(actual.start)}-${minutesToTime(actual.end)}</span>` : ""}
      </div>
      <button class="compact-edit ghost" data-action="edit-shift" data-shift-id="${shift.id}" type="button">変更</button>
    </div>
  `;
}

function compactShiftStyle(item) {
  const startBound = 8 * 60;
  const endBound = 20 * 60;
  const total = endBound - startBound;
  const start = Math.max(0, Math.min(total, item.start - startBound));
  const end = Math.max(0, Math.min(total, (item.end || item.start + 15) - startBound));
  const width = Math.max(2, end - start);
  return `left: ${(start / total) * 100}%; width: ${(width / total) * 100}%;`;
}

function weekDayLabel(date, locale = "ja") {
  const value = typeof date === "string" ? plainDateToUtcDate(date) : date;
  if (locale === "en") {
    return value.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
  }
  const names = ["日", "月", "火", "水", "木", "金", "土"];
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()} (${names[value.getUTCDay()]})`;
}

function timelineDateLabel(date, locale) {
  if (locale === "en") return weekDayLabel(date, "en");
  return date;
}

function renderTimelineShift(shift, bounds, locale = "ja") {
  if (locale === "en") return renderStaffTimelineShift(shift, bounds);

  const punch = shiftPunch(shift);
  const actual = shiftCoverageLabel(shift, punch, locale);
  const display = displayShiftTimes(shift, punch);
  return `
    <div class="timeline-row">
      <div class="timeline-person">
        <div class="title">${escapeHtml(staffName(shift.staffId))}</div>
        <div class="sub">${escapeHtml(actual)}</div>
      </div>
      <div class="timeline-track">
        <div class="timeline-block ${punch ? "worked" : ""}" style="${timelineStyle(display, bounds)}">
          <strong>${minutesToTime(display.start)} - ${display.end ? minutesToTime(display.end) : "..."}</strong>
          <span>${shiftStatusLabel(punch, locale)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderStaffTimelineShift(shift, bounds) {
  const punch = shiftPunch(shift);
  const actual = shiftCoverageLabel(shift, punch, "en");
  const actualTimes = punch ? actualShiftTimes(punch) : null;
  return `
    <div class="timeline-row">
      <div class="timeline-person">
        <div class="title">${escapeHtml(staffName(shift.staffId))}</div>
        <div class="sub">${escapeHtml(actual)}</div>
      </div>
      <div class="timeline-track stacked">
        <div class="timeline-block planned" style="${timelineStyle(shift, bounds)}">
          <strong>Scheduled ${minutesToTime(shift.start)} - ${minutesToTime(shift.end)}</strong>
        </div>
        ${actualTimes ? `
          <div class="timeline-block actual" style="${timelineStyle(actualTimes, bounds)}">
            <strong>Actual ${minutesToTime(actualTimes.start)} - ${minutesToTime(actualTimes.end)}</strong>
            <span>${shiftStatusLabel(punch, "en")}</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function displayShiftTimes(shift, punch) {
  if (!punch) return { start: shift.start, end: shift.end };
  const start = dateToMinutes(new Date(punch.startAt));
  const end = punch.endAt ? dateToMinutes(new Date(punch.endAt)) : null;
  return { start, end };
}

function actualShiftTimes(punch) {
  const start = dateToMinutes(new Date(punch.startAt));
  const end = punch.endAt ? dateToMinutes(new Date(punch.endAt)) : dateToMinutes(new Date());
  return { start, end: Math.max(end, start + 15) };
}

function dateToMinutes(date) {
  const parts = zonedParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function shiftCoverageLabel(shift, punch, locale = "ja") {
  if (locale === "en") {
    if (!punch) return `${staffName(shift.staffId)}'s scheduled shift`;
    if (punch.staffId === shift.staffId) return `${staffName(shift.staffId)} checked in`;
    return `${staffName(punch.staffId)} covered this shift`;
  }
  if (!punch) return `${staffName(shift.staffId)}さんの予定シフト`;
  if (punch.staffId === shift.staffId) return `${staffName(shift.staffId)}さん本人が入りました`;
  return `${staffName(punch.staffId)}さんが代わりに入りました`;
}

function shiftStatusLabel(punch, locale = "ja") {
  if (locale === "en") return punch ? (punch.endAt ? "Done" : "Working") : "Scheduled";
  return punch ? (punch.endAt ? "完了" : "勤務中") : "予定";
}

function timelineBounds(shifts, includeActual = false) {
  const starts = shifts.map((shift) => shift.start);
  const ends = shifts.map((shift) => shift.end);
  if (includeActual) {
    shifts.forEach((shift) => {
      const punch = shiftPunch(shift);
      if (!punch) return;
      const actual = actualShiftTimes(punch);
      starts.push(actual.start);
      ends.push(actual.end);
    });
  }
  const start = Math.min(8 * 60, ...starts);
  const end = Math.max(22 * 60, ...ends);
  return { start, end };
}

function timelineStyle(shift, bounds) {
  const total = Math.max(15, bounds.end - bounds.start);
  const end = shift.end || shift.start + 15;
  const visibleStart = Math.max(bounds.start, shift.start);
  const visibleEnd = Math.min(bounds.end, Math.max(end, shift.start + 15));
  const start = Math.min(100, Math.max(0, ((visibleStart - bounds.start) / total) * 100));
  const width = Math.max(2, ((visibleEnd - visibleStart) / total) * 100);
  return `left: ${start}%; width: ${Math.min(width, 100 - start)}%;`;
}

function renderAdminView() {
  $("#staffList").innerHTML = state.staff.length
    ? state.staff.map((person) => `
      <div class="list-row">
        <div>
          <div class="title">${escapeHtml(person.name)}</div>
          <div class="sub">
            コード
            <button class="code-chip" type="button" data-action="show-staff-code" data-staff-id="${person.id}">
              ${escapeHtml(person.code)}
            </button>
            / $${Number(person.wage).toFixed(2)} / hour
          </div>
        </div>
        <div class="row-actions">
          <button class="ghost" data-action="edit-staff" data-staff-id="${person.id}">編集</button>
          <button class="danger" data-action="delete-staff" data-staff-id="${person.id}">削除</button>
        </div>
      </div>
    `)
    .join("")
    : `<div class="empty">スタッフはまだ登録されていません。</div>`;

  $("#allShifts").innerHTML = renderWeeklyShifts();
  $("#punchList").innerHTML = renderPunchList();
}

function renderPunchList() {
  const punches = [...state.punches]
    .filter((punch) => !punch.endAt)
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))
    .slice(0, 30);
  if (!punches.length) return `<div class="empty">勤務中の打刻はありません。</div>`;
  return punches.map((punch) => {
    const start = new Date(punch.startAt);
    const end = punch.endAt ? new Date(punch.endAt) : null;
    return `
      <div class="list-row">
        <div>
          <div class="title">${escapeHtml(staffName(punch.staffId))}</div>
          <div class="sub">${dateTimeLabel(start)} - ${end ? dateTimeLabel(end) : "勤務中"}</div>
        </div>
        <button class="ghost" data-action="edit-punch" data-punch-id="${punch.id}" type="button">修正</button>
      </div>
    `;
  }).join("");
}

function calculatePayroll(startDate, endDate, staffId = "all") {
  const rows = payrollRows(startDate, endDate, staffId);

  $("#payrollResult").innerHTML = rows
    .map((row) => `
      <div class="pay-row">
        <div>
          <div class="title">${escapeHtml(row.person.name)}</div>
          <div class="sub">${row.hours.toFixed(2)} 時間 x $${Number(row.person.wage).toFixed(2)}</div>
        </div>
        <div class="amount">$${row.pay.toFixed(2)}</div>
      </div>
    `)
    .join("");
}

function payrollRows(startDate, endDate, staffId = "all") {
  const start = dateTimeFromFields(startDate, "00:00");
  const end = dateTimeFromFields(endDate, "23:59");
  return state.staff
    .filter((person) => staffId === "all" || person.id === staffId)
    .map((person) => {
      const punches = state.punches.filter((punch) => {
        if (!punch.endAt || punch.staffId !== person.id) return false;
        const punchStart = new Date(punch.startAt);
        return punchStart >= start && punchStart <= end;
      });
      const minutes = punches.reduce((sum, punch) => {
        return sum + Math.max(0, (new Date(punch.endAt) - new Date(punch.startAt)) / 60000);
      }, 0);
      const hours = minutes / 60;
      return { person, hours, pay: hours * Number(person.wage) };
    });
}

function punchRows(startDate, endDate, staffId = "all") {
  const start = dateTimeFromFields(startDate, "00:00");
  const end = dateTimeFromFields(endDate, "23:59");
  return state.punches
    .filter((punch) => {
      if (staffId !== "all" && punch.staffId !== staffId) return false;
      const punchStart = new Date(punch.startAt);
      return punchStart >= start && punchStart <= end;
    })
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .map((punch) => {
      const started = new Date(punch.startAt);
      const ended = punch.endAt ? new Date(punch.endAt) : null;
      const minutes = ended ? Math.max(0, (ended - started) / 60000) : 0;
      const person = state.staff.find((item) => item.id === punch.staffId);
      const scheduledName = staffName(punch.scheduledStaffId);
      return {
        date: dateKey(started),
        staff: staffName(punch.staffId),
        staffCode: person?.code || "",
        scheduled: scheduledName,
        swapped: punch.scheduledStaffId !== punch.staffId ? "Yes" : "No",
        start: timeLabel(started),
        end: ended ? timeLabel(ended) : "",
        hours: minutes / 60,
        wage: Number(person?.wage || 0),
        pay: (minutes / 60) * Number(person?.wage || 0),
      };
    });
}

function exportSheet(startDate, endDate, staffId = "all") {
  const punchHeaders = ["Date", "Staff", "Staff Code", "Scheduled Staff", "Shift Swap", "Start", "End", "Hours", "Hourly Wage", "Pay"];
  const punchData = punchRows(startDate, endDate, staffId).map((row) => [
    row.date,
    row.staff,
    row.staffCode,
    row.scheduled,
    row.swapped,
    row.start,
    row.end,
    row.hours.toFixed(2),
    row.wage.toFixed(2),
    row.pay.toFixed(2),
  ]);
  const payrollHeaders = ["Staff", "Staff Code", "Hours", "Hourly Wage", "Pay"];
  const payrollData = payrollRows(startDate, endDate, staffId).map((row) => [
    row.person.name,
    row.person.code,
    row.hours.toFixed(2),
    Number(row.person.wage).toFixed(2),
    row.pay.toFixed(2),
  ]);
  const sections = [
    ["Timecard Records"],
    punchHeaders,
    ...punchData,
    [],
    ["Payroll Summary"],
    payrollHeaders,
    ...payrollData,
  ];
  const csv = sections.map((row) => row.map(csvValue).join(",")).join("\n");
  const suffix = exportStaffSuffix(staffId);
  downloadFile(`timecard-${suffix}-${startDate}-to-${endDate}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function exportPdf(startDate, endDate, staffId = "all") {
  const punches = punchRows(startDate, endDate, staffId);
  const payroll = payrollRows(startDate, endDate, staffId);
  const target = staffId === "all" ? "全員まとめて" : staffName(staffId);
  const report = window.open("", "_blank");
  if (!report) {
    alert("PDF保存画面を開けませんでした。ブラウザのポップアップ設定を確認してください。");
    return;
  }

  report.document.write(`
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <title>Timecard ${startDate} to ${endDate}</title>
        <style>
          body { font-family: system-ui, sans-serif; color: #202124; margin: 24px; }
          h1 { font-size: 24px; margin: 0 0 4px; }
          h2 { font-size: 18px; margin: 24px 0 8px; }
          p { color: #697077; margin: 0 0 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d9ddd6; padding: 7px; text-align: left; }
          th { background: #f1f3ef; }
          .num { text-align: right; }
        </style>
      </head>
      <body>
        <h1>Timecard Report</h1>
        <p>${startDate} から ${endDate} / ${escapeHtml(target)}</p>
        <h2>打刻</h2>
        ${reportTable(
          ["日付", "担当", "コード", "予定", "交代", "開始", "終了", "時間", "時給", "給与"],
          punches.map((row) => [
            row.date,
            row.staff,
            row.staffCode,
            row.scheduled,
            row.swapped === "Yes" ? "あり" : "なし",
            row.start,
            row.end,
            row.hours.toFixed(2),
            `$${row.wage.toFixed(2)}`,
            `$${row.pay.toFixed(2)}`,
          ]),
        )}
        <h2>給与集計</h2>
        ${reportTable(
          ["スタッフ", "コード", "時間", "時給", "給与"],
          payroll.map((row) => [
            row.person.name,
            row.person.code,
            row.hours.toFixed(2),
            `$${Number(row.person.wage).toFixed(2)}`,
            `$${row.pay.toFixed(2)}`,
          ]),
        )}
      </body>
    </html>
  `);
  report.document.close();
  report.focus();
  report.print();
}

function exportStaffSuffix(staffId) {
  if (staffId === "all") return "all-staff";
  return staffName(staffId)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]/g, "");
}

function reportTable(headers, rows) {
  if (!rows.length) return "<p>データはありません。</p>";
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function csvValue(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportFullBackup() {
  const backup = {
    app: "sakura-mart-timecard",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadFile(`timecard-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
}

function restoreFullBackup(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const backup = JSON.parse(reader.result);
      const data = backup.data || backup;
      if (!Array.isArray(data.staff) || !Array.isArray(data.shifts) || !Array.isArray(data.punches)) {
        throw new Error("Invalid backup");
      }
      if (!confirm("現在のデータをバックアップの内容で置き換えます。よろしいですか？")) return;
      state.staff = staffWithCodes(data.staff);
      state.shifts = data.shifts;
      state.punches = data.punches;
      state.shiftNotes = data.shiftNotes || {};
      state.adminPasscode = data.adminPasscode || "1968";
      activeStaffId = "";
      saveState();
      resetStaffForm();
      render();
      alert("バックアップを復元しました。");
    } catch {
      alert("バックアップファイルを読み込めませんでした。");
    } finally {
      $("#restoreJsonInput").value = "";
    }
  });
  reader.readAsText(file);
}

function clockIn(shiftId = null) {
  const staffId = currentStaffId();
  if (!staffId || openPunchFor(staffId)) return;

  const shift = state.shifts.find((item) => item.id === shiftId);
  if (!shift || shiftPunch(shift)) return;
  const startAt = roundToQuarter(new Date());
  state.punches.push({
    id: newId(),
    staffId,
    shiftId,
    scheduledStaffId: shift?.staffId || staffId,
    startAt: startAt.toISOString(),
    endAt: null,
  });
  activeStaffId = "";
  $("#staffCodeInput").value = "";
  $("#staffCodeError").classList.add("hidden");
  render();
}

function clockOut() {
  const punch = openPunchFor(currentStaffId());
  if (!punch) return;
  punch.endAt = roundToQuarter(new Date()).toISOString();
  activeStaffId = "";
  $("#staffCodeInput").value = "";
  render();
}

function editStaff(staffId) {
  const person = state.staff.find((item) => item.id === staffId);
  if (!person) return;
  $("#staffDialogTitle").textContent = "スタッフ変更";
  $("#staffEditId").value = person.id;
  $("#staffName").value = person.name;
  $("#staffWage").value = Number(person.wage).toFixed(2);
  $("#staffCode").value = person.code;
  $("#staffSubmitBtn").textContent = "保存";
}

function resetStaffForm() {
  $("#staffDialogTitle").textContent = "スタッフ追加";
  $("#staffEditId").value = "";
  $("#staffForm").reset();
  $("#staffWage").value = "17.40";
  $("#staffCode").value = generateStaffCode();
  $("#staffSubmitBtn").textContent = "追加";
  $("#staffCancelBtn").classList.remove("hidden");
}

function deleteStaff(staffId) {
  const hasRecords = state.shifts.some((shift) => shift.staffId === staffId)
    || state.punches.some((punch) => punch.staffId === staffId || punch.scheduledStaffId === staffId);
  if (hasRecords) {
    alert("このスタッフにはシフトまたは打刻データがあるため削除できません。名前や時給は編集できます。");
    return;
  }
  state.staff = state.staff.filter((person) => person.id !== staffId);
  resetStaffForm();
  render();
}

function timeLabel(date) {
  return timeFormatter.format(date);
}

function dateTimeLabel(date) {
  return `${dateKey(date)} ${timeLabel(date)}`;
}

function dateTimeFromFields(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const { year, month, day } = parseDateKey(dateValue);
  const [hours, minutes] = timeValue.split(":").map(Number);
  let utcMillis = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let index = 0; index < 2; index += 1) {
    const offset = getTimeZoneOffsetMinutes(new Date(utcMillis));
    const corrected = Date.UTC(year, month - 1, day, hours, minutes, 0) - offset * 60000;
    if (corrected === utcMillis) break;
    utcMillis = corrected;
  }
  const date = new Date(utcMillis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateTimeFromDateKeyAndMinutes(dateValue, minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return dateTimeFromFields(dateValue, `${hours}:${mins}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) {
    if (tab.dataset.view === "adminView" && !adminUnlocked) {
      openPasscodeDialog();
      return;
    }
    if (tab.dataset.view !== "adminView") adminUnlocked = false;
    switchView(tab.dataset.view);
  }

  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "clock-in") clockIn(action.dataset.shiftId || null);
  if (action?.dataset.action === "edit-staff") openStaffDialog(action.dataset.staffId);
  if (action?.dataset.action === "delete-staff") deleteStaff(action.dataset.staffId);
  if (action?.dataset.action === "show-staff-code") openStaffCodeDialog(action.dataset.staffId);
  if (action?.dataset.action === "edit-shift") openShiftDialog(action.dataset.shiftId);
  if (action?.dataset.action === "edit-punch") openPunchDialog(action.dataset.punchId);
});

document.addEventListener("input", (event) => {
  const note = event.target.closest("[data-action='shift-note']");
  if (!note) return;
  state.shiftNotes[note.dataset.date] = note.value;
  saveState();
});

$("#clockOutBtn").addEventListener("click", clockOut);

$("#staffCodeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("#staffCodeInput").value.trim();
  $("#staffCodeInput").value = "";
  const person = state.staff.find((item) => item.code === code);
  if (!person) {
    activeStaffId = "";
    $("#staffCodeError").classList.remove("hidden");
    render();
    return;
  }
  activeStaffId = person.id;
  $("#staffCodeError").classList.add("hidden");
  render();
});

$("#adminUnlockForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("#adminPasscodeInput").value === state.adminPasscode) {
    adminUnlocked = true;
    closePasscodeDialog();
    switchView("adminView");
    return;
  }
  $("#passcodeError").classList.remove("hidden");
});

$("#passcodeCancelBtn").addEventListener("click", closePasscodeDialog);
$("#saveCancelBtn").addEventListener("click", closeSaveDialog);
$("#openShiftModalBtn").addEventListener("click", () => openShiftDialog());
$("#shiftCancelBtn").addEventListener("click", closeShiftDialog);
$("#openStaffModalBtn").addEventListener("click", () => openStaffDialog());
$("#staffCancelBtn").addEventListener("click", closeStaffDialog);
$("#staffCodeCloseBtn").addEventListener("click", closeStaffCodeDialog);
$("#punchCancelBtn").addEventListener("click", closePunchDialog);

$("#passcodeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const passcode = $("#newPasscode").value.trim();
  if (!passcode) return;
  state.adminPasscode = passcode;
  $("#newPasscode").value = "";
  saveState();
  alert("管理者パスコードを変更しました。");
});

$("#storeSettingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const storeName = $("#storeNameInput").value.trim();
  if (!storeName) return;
  state.storeName = storeName;
  render();
  alert("店舗名を保存しました。");
});

$("#storeNameInput").addEventListener("input", () => {
  const storeName = $("#storeNameInput").value.trim();
  if (!storeName) return;
  $("#storeNameHeading").textContent = storeName;
  document.title = `Timecard | ${storeName}`;
});

$("#staffForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const staffId = $("#staffEditId").value;
  const name = $("#staffName").value.trim();
  const wage = Number($("#staffWage").value);
  const code = $("#staffCode").value.trim();
  if (!name) return;
  if (!/^\d{5}$/.test(code)) {
    alert("スタッフコードは5桁の数字にしてください。");
    return;
  }
  const duplicate = state.staff.find((person) => person.code === code && person.id !== staffId);
  if (duplicate) {
    alert("このスタッフコードは既に使われています。");
    return;
  }

  if (staffId) {
    const person = state.staff.find((item) => item.id === staffId);
    if (person) {
      person.name = name;
      person.wage = wage;
      person.code = code;
    }
  } else {
    state.staff.push({ id: newId(), name, wage, code });
  }

  resetStaffForm();
  closeStaffDialog();
  render();
});

$("#prevWeekBtn").addEventListener("click", () => moveShiftWeek(-7));
$("#nextWeekBtn").addEventListener("click", () => moveShiftWeek(7));

$("#shiftForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const shiftId = $("#shiftEditId").value;
  const start = timeToMinutes($("#shiftStart").value);
  const end = timeToMinutes($("#shiftEnd").value);
  if (end <= start) {
    alert("終了時刻は開始時刻より後にしてください。");
    return;
  }
  if (shiftId) {
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (shift) {
      shift.date = $("#shiftDate").value;
      shift.staffId = $("#shiftStaff").value;
      shift.start = start;
      shift.end = end;
    }
  } else {
    state.shifts.push({
      id: newId(),
      date: $("#shiftDate").value,
      staffId: $("#shiftStaff").value,
      start,
      end,
    });
  }
  closeShiftDialog();
  render();
});

$("#punchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const punch = state.punches.find((item) => item.id === $("#punchEditId").value);
  if (!punch) return;
  const start = dateTimeFromFields($("#punchStartDate").value, $("#punchStartTime").value);
  const endDateValue = $("#punchEndDate").value;
  const endTimeValue = $("#punchEndTime").value;
  if ((endDateValue && !endTimeValue) || (!endDateValue && endTimeValue)) {
    alert("終了日時は日付と時刻を両方入力してください。");
    return;
  }
  const end = endDateValue && endTimeValue ? dateTimeFromFields(endDateValue, endTimeValue) : null;
  if (!start) return;
  if (end && end <= start) {
    alert("終了時刻は開始時刻より後にしてください。");
    return;
  }
  punch.startAt = start.toISOString();
  punch.endAt = end ? end.toISOString() : null;
  closePunchDialog();
  render();
});

$("#payrollForm").addEventListener("submit", (event) => {
  event.preventDefault();
  calculatePayroll($("#payStart").value, $("#payEnd").value, $("#payStaff").value);
});

$("#savePayrollBtn").addEventListener("click", openSaveDialog);

$("#backupJsonBtn").addEventListener("click", exportFullBackup);

$("#restoreJsonBtn").addEventListener("click", () => {
  $("#restoreJsonInput").click();
});

$("#restoreJsonInput").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) restoreFullBackup(file);
});

$("#sheetExportBtn").addEventListener("click", () => {
  exportSheet($("#payStart").value, $("#payEnd").value, $("#payStaff").value);
  closeSaveDialog();
});

$("#pdfExportBtn").addEventListener("click", () => {
  exportPdf($("#payStart").value, $("#payEnd").value, $("#payStaff").value);
  closeSaveDialog();
});

const today = dateKey(new Date());
populateTimeSelects();
$("#shiftWeekStart").value = mondayOf(today);
$("#payStart").value = today;
$("#payEnd").value = today;
$("#staffCode").value = generateStaffCode();

setInterval(() => {
  renderHeader();
  if (activeViewId() === "staffView" && state.punches.some((punch) => !punch.endAt)) {
    renderStaffView();
  }
}, 1000);
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}
