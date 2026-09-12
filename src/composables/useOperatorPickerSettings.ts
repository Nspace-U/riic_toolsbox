import { ref } from "vue";

export const DEFAULT_OPERATOR_PICKER_COLUMNS = 4;

const OPERATOR_PICKER_SETTINGS_STORAGE_KEY =
  "riic-tools:operator-picker-settings:v1";

function normalizeOperatorPickerColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return DEFAULT_OPERATOR_PICKER_COLUMNS;
  }
  return value;
}

function readOperatorPickerColumns(): number {
  if (typeof window === "undefined") {
    return DEFAULT_OPERATOR_PICKER_COLUMNS;
  }

  try {
    const storedValue = window.localStorage.getItem(
      OPERATOR_PICKER_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return DEFAULT_OPERATOR_PICKER_COLUMNS;
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return DEFAULT_OPERATOR_PICKER_COLUMNS;
    }
    return normalizeOperatorPickerColumns(
      (parsedValue as Record<string, unknown>).columns,
    );
  } catch {
    return DEFAULT_OPERATOR_PICKER_COLUMNS;
  }
}

const operatorPickerColumns = ref(readOperatorPickerColumns());

function persistOperatorPickerColumns(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      OPERATOR_PICKER_SETTINGS_STORAGE_KEY,
      JSON.stringify({ columns: operatorPickerColumns.value }),
    );
  } catch {}
}

function setOperatorPickerColumns(value: number): void {
  operatorPickerColumns.value = normalizeOperatorPickerColumns(value);
  persistOperatorPickerColumns();
}

function resetOperatorPickerColumns(): void {
  operatorPickerColumns.value = DEFAULT_OPERATOR_PICKER_COLUMNS;
  persistOperatorPickerColumns();
}

export function useOperatorPickerSettings() {
  return {
    operatorPickerColumns,
    setOperatorPickerColumns,
    resetOperatorPickerColumns,
  };
}
