import { STORE_KEY } from "./constants.js";
import { createDefaultState, normalizeState } from "./model.js";

export function loadState(storage = window.localStorage) {
  const raw = storage.getItem(STORE_KEY);
  if (!raw) return createDefaultState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

export function saveState(state, storage = window.localStorage) {
  storage.setItem(STORE_KEY, JSON.stringify(state));
}
