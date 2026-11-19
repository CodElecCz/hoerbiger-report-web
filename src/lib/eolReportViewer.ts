import Chart from "chart.js/auto";
import type { CsvSection } from "./csvReport";
import { numberValue, resultFromFileName } from "./adjReportData";
import {
  EOL_METRICS,
  findColumnIndex,
  getEolMetricChecks,
  groupMeasurementsByStep,
  type EolMetricCheck,
} from "./eolReportData";

type TableCell = string | HTMLElement;

function display(value: string | undefined): string {
  return value?.trim() || "—";
}

function columnTitle(section: CsvSection, index: number): string {
  const unit = section.units[index]?.trim();
  return [section.columns[index]?.trim(), unit && unit !== "-" ? unit : ""].filter(Boolean).join(" ");
}

function makeTable(
  headers: string[],
  rows: TableCell[][],
  className = "",
  cellClass?: (rowIndex: number, columnIndex: number) => string | undefined,
): HTMLTableElement {
  const element = document.createElement("table");
  element.className = `eol-table ${className}`.trim();
  const thead = element.createTHead();
  const header = thead.insertRow();
  headers.forEach((value) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = value;
    header.appendChild(th);
  });
  const tbody = element.createTBody();
  rows.forEach((values, rowIndex) => {
    const row = tbody.insertRow();
    values.forEach((value, columnIndex) => {
      const cell = row.insertCell();
      const cls = cellClass?.(rowIndex, columnIndex);
      if (cls) cell.className = cls;
      if (typeof value === "string") cell.textContent = display(value);
      else cell.appendChild(value);
    });
  });
  return element;
}

function splitUnit(value: string): [string, string] {
  const match = /^(.*?)\s*(\[[^\]]+\])$/.exec(value.trim());
  return match ? [match[1].trim(), match[2]] : [value.trim(), ""];
}

function keyValueTable(section: CsvSection | undefined, stripSdm = false): HTMLTableElement {
  const rows: TableCell[][] = (section?.rows ?? []).map((row) => {
    let label = row[0]?.trim() ?? "";
    if (stripSdm) label = label.replace(/^SDM\s*-\s*/i, "");

    const nestedSeparator = label.indexOf(" - ");
    const nestedLabels = nestedSeparator >= 0 ? label.slice(nestedSeparator + 3).split("/") : [];
    if (nestedLabels.length > 1) {
      const [name, unit] = splitUnit(label.slice(0, nestedSeparator));
      const values = row.slice(1, nestedLabels.length + 1).map(display);
      return [
        name,
        unit,
        makeTable(nestedLabels.map((item) => item.trim()), [values], "eol-nested-table"),
      ];
    }

    if (row.length >= 3 && /^\[[^\]]+\]$/.test(row[1]?.trim() ?? "")) {
      return [label, row[1].trim(), row.slice(2).map(display).join(" / ")];
    }
    const [name, unit] = splitUnit(label);
    return [name, unit, row.slice(1).map(display).join(" / ")];
  });
  return makeTable(["Field", "Unit", "Value"], rows, "eol-key-value-table");
}

function detailCard(title: string, open = false): { element: HTMLDetailsElement; body: HTMLDivElement } {
  const element = document.createElement("details");
  element.className = "eol-card";
  element.open = open;
  const summary = document.createElement("summary");
  summary.textContent = title;
  const body = document.createElement("div");
  body.className = "eol-card-body";
  element.append(summary, body);
  return { element, body };
}

function findSection(sections: CsvSection[], name: string): CsvSection | undefined {
  return sections.find((section) => section.name.trim().toLowerCase() === name.toLowerCase());
}

function headerValue(section: CsvSection | undefined, name: string): string {
  const row = section?.rows.find((item) => item[0]?.trim().toLowerCase() === name.toLowerCase());
  if (!row) return "";
  return row.length >= 3 && /^\[[^\]]+\]$/.test(row[1]?.trim() ?? "") ? row[2] ?? "" : row[1] ?? "";
}

function checksForMetric(checks: EolMetricCheck[], metric: string): EolMetricCheck | undefined {
  return checks.find((check) => check.metric === metric);
}

function statusBadge(status: EolMetricCheck["status"]): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = `eol-badge eol-badge-${status.toLowerCase()}`;
  badge.textContent = status;
  return badge;
}

function metricCheckTable(checks: EolMetricCheck[]): HTMLTableElement {
  return makeTable(
    ["Parameter", "Unit", "Min", "Max", "Value", "Result"],
    checks.map((check) => [
      check.metric,
      display(check.unit),
      display(check.min),
      display(check.max),
      display(check.value),
      statusBadge(check.status),
    ]),
    "eol-check-table",
  );
}

function resultRowForStep(results: CsvSection | undefined, step: number): string[] | undefined {
  if (!results) return undefined;
  const index = findColumnIndex(results.columns, "Step");
  if (index < 0) return undefined;
  return results.rows.find((row) => numberValue(row[index]) === step);
}

function resultTable(
  results: CsvSection | undefined,
  rows: string[][],
  className = "",
): HTMLTableElement | null {
  if (!results) return null;
  const indices = results.columns
    .map((column, index) => ({ column: column.trim(), index }))
    .filter(({ column }) => column && !/^Limit\s/i.test(column))
    .map(({ index }) => index);
  const headers = indices.map((index) => columnTitle(results, index));
  const values = rows.map((row) => indices.map((index) => row[index] ?? ""));
  const metricColumn = new Map<number, EolMetricCheck["status"]>();
  EOL_METRICS.forEach((metric) => {
    const index = findColumnIndex(results.columns, metric);
    if (index < 0) return;
    rows.forEach((row, rowIndex) => {
      const check = getEolMetricChecks(results, row).find((item) => item.metric === metric);
      if (check) metricColumn.set(rowIndex * results.columns.length + index, check.status);
    });
  });
  return makeTable(headers, values, className, (rowIndex, columnIndex) => {
    const originalIndex = indices[columnIndex];
    const status = metricColumn.get(rowIndex * results.columns.length + originalIndex);
    return status ? `eol-check-${status.toLowerCase()}` : undefined;
  });
}

function measurementPoints(section: CsvSection, rows: string[][], name: string): { x: number; y: number | null }[] {
  const timeIndex = findColumnIndex(section.columns, "Time");
  const valueIndex = findColumnIndex(section.columns, name);
  if (timeIndex < 0 || valueIndex < 0) return [];
  return rows.flatMap((row) => {
    const x = numberValue(row[timeIndex]);
    if (x === null) return [];
    return [{ x, y: numberValue(row[valueIndex]) }];
  });
}

export class EolReportViewer {
  private charts: Chart[] = [];

  constructor(
    private sections: CsvSection[],
    private fileName: string,
  ) {}

  render(container: HTMLElement): void {
    const header = findSection(this.sections, "Header");
    const conditions = findSection(this.sections, "Conditions");
    const results = findSection(this.sections, "Results");
    const measurement = findSection(this.sections, "Measurement");
    const report = document.createElement("div");
    report.className = "eol-report";

    const banner = document.createElement("div");
    banner.className = "eol-banner";
    const bannerTitle = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Part Protocol Report";
    const station = document.createElement("div");
    station.textContent = `Station name: ${this.fileName.split("_")[0] || "EOL"}`;
    const recipe = document.createElement("div");
    recipe.textContent = `Recipe name: ${headerValue(header, "Recipe") || "—"}`;
    bannerTitle.append(title, station, recipe);
    const meta = document.createElement("div");
    meta.className = "eol-report-meta";
    const dateTime = document.createElement("div");
    dateTime.textContent = `Date time: ${headerValue(header, "Date Time") || "—"}`;
    const file = document.createElement("div");
    file.textContent = `File report name: ${this.fileName}`;
    meta.append(dateTime, file);
    banner.append(bannerTitle, meta);

    const result = resultFromFileName(this.fileName);
    const resultBar = document.createElement("div");
    resultBar.className = `eol-result eol-result-${result.toLowerCase()}`;
    resultBar.textContent = `Result: ${result}`;
    report.append(banner, resultBar);
    container.appendChild(report);

    this.renderHeader(report, header);
    this.renderConditions(report, conditions);
    this.renderResults(report, results);
    this.renderMeasurement(report, measurement, results);
    this.renderLeakage(report);
  }

  private renderHeader(report: HTMLElement, header: CsvSection | undefined): void {
    const card = detailCard("Header", true);
    const grid = document.createElement("div");
    grid.className = "eol-header-grid";
    const regular = header?.rows.filter((row) => !/^SDM\s*-/i.test(row[0] ?? "")) ?? [];
    const sdm = header?.rows.filter((row) => /^SDM\s*-/i.test(row[0] ?? "")) ?? [];
    grid.appendChild(keyValueTable(header ? { ...header, rows: regular } : undefined));
    if (sdm.length) grid.appendChild(keyValueTable(header ? { ...header, rows: sdm } : undefined, true));
    card.body.appendChild(grid);
    report.appendChild(card.element);
  }

  private renderConditions(report: HTMLElement, conditions: CsvSection | undefined): void {
    const card = detailCard("Conditions");
    card.body.appendChild(keyValueTable(conditions));
    report.appendChild(card.element);
  }

  private renderResults(report: HTMLElement, results: CsvSection | undefined): void {
    const card = detailCard("Results");
    const scroll = document.createElement("div");
    scroll.className = "eol-table-scroll";
    const rendered = resultTable(results, results?.rows ?? [], "eol-results-table");
    if (rendered) scroll.appendChild(rendered);
    else scroll.textContent = "No results data available.";
    card.body.appendChild(scroll);
    report.appendChild(card.element);
  }

  private renderMeasurement(report: HTMLElement, measurement: CsvSection | undefined, results: CsvSection | undefined): void {
    const groups = groupMeasurementsByStep(measurement);
    for (const group of groups) {
      const card = detailCard(`Measurement Time Graph - Step ${group.step}`, true);
      const stepLabel = document.createElement("div");
      stepLabel.className = "eol-step-label";
      stepLabel.textContent = `Step ${group.step}`;
      card.body.appendChild(stepLabel);

      const resultRow = resultRowForStep(results, group.step);
      const summaryTable = resultTable(results, resultRow ? [resultRow] : [], "eol-step-summary");
      if (summaryTable) {
        const scroll = document.createElement("div");
        scroll.className = "eol-table-scroll";
        scroll.appendChild(summaryTable);
        card.body.appendChild(scroll);
      }

      const checks = getEolMetricChecks(results, resultRow);
      card.body.appendChild(metricCheckTable(checks));
      const plot = document.createElement("div");
      plot.className = "eol-chart";
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `EOL measurement chart for step ${group.step}`);
      plot.appendChild(canvas);
      card.body.appendChild(plot);
      report.appendChild(card.element);
      if (measurement) this.addStepChart(canvas, measurement, group.rows, checks);
    }
    if (!groups.length) {
      const card = detailCard("Measurement Time Graph", true);
      card.body.textContent = "No step-based measurement data available.";
      report.appendChild(card.element);
    }
  }

  private addStepChart(canvas: HTMLCanvasElement, section: CsvSection, rows: string[][], checks: EolMetricCheck[]): void {
    const timeIndex = findColumnIndex(section.columns, "Time");
    const aeff = measurementPoints(section, rows, "Aeff");
    const pressure = measurementPoints(section, rows, "Pressure S3");
    const times = rows.flatMap((row) => {
      const value = numberValue(row[timeIndex]);
      return value === null ? [] : [value];
    });
    if (timeIndex < 0 || !times.length || (!aeff.length && !pressure.length)) {
      canvas.parentElement!.textContent = "No plottable Aeff or Pressure S3 data available for this step.";
      return;
    }
    const [minTime, maxTime] = times.reduce(
      ([minimum, maximum], value) => [Math.min(minimum, value), Math.max(maximum, value)],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    );
    const endTime = minTime === maxTime ? minTime + 1 : maxTime;
    const datasets: Chart<"line", { x: number; y: number | null }[]>["data"]["datasets"] = [];
    if (aeff.length) datasets.push({
      label: `Aeff ${section.units[findColumnIndex(section.columns, "Aeff")] ?? ""}`.trim(),
      data: aeff,
      borderColor: "#0f6cc2",
      backgroundColor: "#0f6cc2",
      yAxisID: "y",
      pointRadius: 0,
      borderWidth: 1.5,
      spanGaps: false,
    });
    if (pressure.length) datasets.push({
      label: `Pressure S3 ${section.units[findColumnIndex(section.columns, "Pressure S3")] ?? ""}`.trim(),
      data: pressure,
      borderColor: "#b04f00",
      backgroundColor: "#b04f00",
      yAxisID: "yPressure",
      pointRadius: 0,
      borderWidth: 1.5,
      spanGaps: false,
    });

    const addLimits = (metric: "Aeff Mean" | "Pressure S3 Mean", axis: string, color: string) => {
      const check = checksForMetric(checks, metric);
      if (!check) return;
      for (const bound of ["min", "max"] as const) {
        const value = bound === "min" ? check.minValue : check.maxValue;
        if (value === null) continue;
        datasets.push({
          label: `${metric} ${bound === "min" ? "Min" : "Max"}`,
          data: [{ x: minTime, y: value }, { x: endTime, y: value }],
          borderColor: color,
          backgroundColor: color,
          borderDash: [6, 3],
          yAxisID: axis,
          pointRadius: 0,
          borderWidth: 1,
          spanGaps: false,
        });
      }
    };
    addLimits("Aeff Mean", "y", "#0f6cc2");
    addLimits("Pressure S3 Mean", "yPressure", "#b04f00");

    this.charts.push(new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        animation: false,
        parsing: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: `Time ${section.units[timeIndex] ?? ""}`.trim() },
          },
          y: { title: { display: true, text: `Aeff ${section.units[findColumnIndex(section.columns, "Aeff")] ?? ""}`.trim() } },
          yPressure: {
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: `Pressure S3 ${section.units[findColumnIndex(section.columns, "Pressure S3")] ?? ""}`.trim() },
          },
        },
      },
    }));
  }

  private renderLeakage(report: HTMLElement): void {
    const leakage = findSection(this.sections, "Leakage");
    const results = findSection(this.sections, "Leakage - Results");
    const measurement = findSection(this.sections, "Leakage - Measurement");
    if (!leakage && !results && !measurement) return;

    const card = detailCard("Leakage", true);
    const summaries = document.createElement("div");
    summaries.className = "eol-header-grid";
    if (leakage) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = "Conditions";
      section.append(heading, keyValueTable(leakage));
      summaries.appendChild(section);
    }
    if (results) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = "Results";
      section.append(heading, keyValueTable(results));
      summaries.appendChild(section);
    }
    card.body.appendChild(summaries);

    if (measurement?.rows.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Measurements";
      const scroll = document.createElement("div");
      scroll.className = "eol-table-scroll";
      const headers = measurement.columns.map((_, index) => columnTitle(measurement, index));
      const table = makeTable(headers, measurement.rows.map((row) => row.map(display)), "eol-leakage-table");
      scroll.appendChild(table);
      card.body.append(heading, scroll);
    }
    report.appendChild(card.element);
  }

  destroy(): void {
    for (const chart of this.charts) chart.destroy();
    this.charts = [];
  }
}
