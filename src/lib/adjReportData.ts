import type { CsvSection } from "./csvReport";

export function numberValue(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.trim().replace(/^([-+]?\d+),(\d+)$/, "$1.$2"));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resultFromFileName(fileName: string): "OK" | "NOK" | "ERROR" | "Unknown" {
  const result = /_(OK|NOK|NG|FAIL|ERROR)\.csv$/i.exec(fileName)?.[1].toUpperCase();
  return result === "OK" || result === "ERROR" ? result : result ? "NOK" : "Unknown";
}

export function getAeffLimit(header: CsvSection | undefined, results: CsvSection | undefined) {
  const limitRow = header?.rows.find((row) => /^Aeff\s*-\s*/i.test(row[0] ?? ""));
  const labels = (limitRow?.[0] ?? "").replace(/^Aeff\s*-\s*/i, "").split("/");
  const findLimit = (name: string) => {
    const index = labels.findIndex((label) => new RegExp(`^${name}\\s*(?:\\[|$)`, "i").test(label.trim()));
    return index < 0 ? "" : limitRow?.[index + 1] ?? "";
  };
  const min = findLimit("Limit Min");
  const max = findLimit("Limit Max");
  const resultRow = results?.rows.find((row) => /^Adjustment\s*\[Meas\]\s*-\s*Aeff\b/i.test(row[0] ?? ""));
  const value = resultRow?.[1] ?? "";
  const unit = /\[[^\]]+\]\s*$/.exec(resultRow?.[0] ?? "")?.[0].trim() ?? "";
  const minNumber = numberValue(min);
  const maxNumber = numberValue(max);
  const measured = numberValue(value);
  const status = minNumber === null || maxNumber === null || measured === null || minNumber > maxNumber
    ? "Unknown"
    : measured >= minNumber && measured <= maxNumber ? "OK" : "NOK";
  return { min, max, value, unit, status };
}

export interface MeasurementSeries {
  name: string;
  unit: string;
  points: { x: number; y: number | null }[];
}

export function measurementSeries(section: CsvSection, names: string[], steps?: number[]): MeasurementSeries[] {
  const findColumn = (name: string) => section.columns.findIndex((column) => column.trim().toLowerCase() === name.toLowerCase());
  const timeIndex = findColumn("Time");
  const stepIndex = findColumn("Step");
  if (timeIndex < 0 || (steps && stepIndex < 0)) return [];
  return names.flatMap((name) => {
    const index = findColumn(name);
    if (index < 0) return [];
    const points = section.rows.flatMap((row) => {
      const time = numberValue(row[timeIndex]);
      const step = numberValue(row[stepIndex]);
      if (time === null || (steps && (step === null || !steps.includes(step)))) return [];
      return [{ x: time, y: numberValue(row[index]) }];
    });
    return [{ name, unit: section.units[index] ?? "", points }];
  });
}
