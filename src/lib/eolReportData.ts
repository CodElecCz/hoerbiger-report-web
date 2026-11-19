import type { CsvSection } from "./csvReport";
import { numberValue } from "./adjReportData.ts";

export const EOL_METRICS = [
  "Aeff Mean",
  "Pressure S3 Mean",
  "Aeff StdDev",
  "Pressure S3 StdDev",
] as const;

export type EolMetricCheck = {
  metric: (typeof EOL_METRICS)[number];
  unit: string;
  value: string;
  min: string;
  max: string;
  numericValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  status: "OK" | "NOK" | "Unknown";
};

export type EolMeasurementGroup = {
  step: number;
  rows: string[][];
};

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findColumnIndex(columns: string[], name: string): number {
  const key = normalized(name);
  return columns.findIndex((column) => normalized(column) === key);
}

export function getEolMetricChecks(
  results: CsvSection | undefined,
  row: string[] | undefined,
): EolMetricCheck[] {
  return EOL_METRICS.map((metric) => {
    const valueIndex = results ? findColumnIndex(results.columns, metric) : -1;
    const minIndex = results ? findColumnIndex(results.columns, `Limit Min - ${metric}`) : -1;
    const maxIndex = results ? findColumnIndex(results.columns, `Limit Max - ${metric}`) : -1;
    const value = valueIndex >= 0 ? row?.[valueIndex]?.trim() ?? "" : "";
    const min = minIndex >= 0 ? row?.[minIndex]?.trim() ?? "" : "";
    const max = maxIndex >= 0 ? row?.[maxIndex]?.trim() ?? "" : "";
    const numericValue = numberValue(value);
    const minValue = numberValue(min);
    const maxValue = numberValue(max);
    const hasLimit = minValue !== null || maxValue !== null;
    const invalidLimits = minValue !== null && maxValue !== null && minValue > maxValue;
    const status = numericValue === null || !hasLimit || invalidLimits
      ? "Unknown"
      : (minValue !== null && numericValue < minValue) || (maxValue !== null && numericValue > maxValue)
        ? "NOK"
        : "OK";

    return {
      metric,
      unit: valueIndex >= 0 ? results?.units[valueIndex]?.trim() ?? "" : "",
      value,
      min,
      max,
      numericValue,
      minValue,
      maxValue,
      status,
    };
  });
}

export function groupMeasurementsByStep(measurement: CsvSection | undefined): EolMeasurementGroup[] {
  if (!measurement) return [];
  const stepIndex = findColumnIndex(measurement.columns, "Step");
  if (stepIndex < 0) return [];

  const groups = new Map<number, string[][]>();
  for (const row of measurement.rows) {
    const step = numberValue(row[stepIndex]);
    if (step === null) continue;
    const rows = groups.get(step) ?? [];
    rows.push(row);
    groups.set(step, rows);
  }

  return Array.from(groups, ([step, rows]) => ({ step, rows })).sort((a, b) => a.step - b.step);
}
