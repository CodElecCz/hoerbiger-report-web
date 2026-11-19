import Chart from "chart.js/auto";
import type { CsvSection } from "./csvReport";
import { getAeffLimit, measurementSeries, resultFromFileName } from "./adjReportData";

type GraphSeries = {
  name: string;
  color: string;
  axis: "y" | "yPosition";
  dash?: number[];
};

const AEFF_SERIES: GraphSeries[] = [
  { name: "Aeff Calc Actual", color: "#22d3ee", axis: "y" },
  { name: "Aeff Meas Actual", color: "#34d399", axis: "y" },
  { name: "Aeff Target", color: "#fbbf24", axis: "y", dash: [7, 5] },
  { name: "Aeff Target Step", color: "#fb923c", axis: "y", dash: [2, 4] },
  { name: "Position", color: "#a78bfa", axis: "yPosition" },
];

function card(title: string, open = true): { element: HTMLElement; body: HTMLElement } {
  const element = document.createElement("details");
  element.className = "adj-card";
  element.open = open;
  const summary = document.createElement("summary");
  summary.textContent = title;
  const body = document.createElement("div");
  body.className = "adj-card-body";
  element.append(summary, body);
  return { element, body };
}

function table(headings: string[], rows: string[][]): HTMLTableElement {
  const element = document.createElement("table");
  const thead = element.createTHead();
  const header = thead.insertRow();
  for (const heading of headings) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = heading;
    header.appendChild(th);
  }
  const tbody = element.createTBody();
  for (const values of rows) {
    const row = tbody.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
  return element;
}

function splitUnit(label: string): [string, string] {
  const match = /^(.*?)\s*(\[[^\]]+\])$/.exec(label.trim());
  return match ? [match[1].trim(), match[2]] : [label.trim(), ""];
}

function fields(section: CsvSection | undefined): string[][] {
  return (section?.rows ?? []).flatMap((row) => {
    const label = row[0] ?? "";
    const separator = label.indexOf(" - ");
    const group = separator >= 0 ? label.slice(0, separator).trim() : "";
    const labels = (separator >= 0 ? label.slice(separator + 3) : label).split("/");
    const count = Math.max(labels.length, row.length - 1);
    return Array.from({ length: count }, (_, index) => {
      const [name, unit] = splitUnit(labels[index] ?? `Value ${index + 1}`);
      return [group ? `${group} - ${name}` : name, unit, row[index + 1] ?? ""];
    });
  });
}

function addSection(report: HTMLElement, title: string, headings: string[], rows: string[][]) {
  const section = card(title);
  if (rows.length) section.body.appendChild(table(headings, rows));
  else section.body.textContent = `No ${title.toLowerCase()} data available.`;
  report.appendChild(section.element);
}

export class AdjReportViewer {
  private charts: Chart[] = [];

  constructor(
    private sections: CsvSection[],
    private fileName: string,
    private csvText: string,
  ) {}

  render(container: HTMLElement): void {
    const section = (name: string) => this.sections.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const header = section("header");
    const results = section("results");
    const measurement = section("measurement");
    const report = document.createElement("div");
    report.className = "adj-report";

    const banner = document.createElement("div");
    banner.className = "adj-banner";
    const title = document.createElement("h2");
    title.textContent = "Part Protocol Report";
    const file = document.createElement("span");
    file.textContent = this.fileName;
    banner.append(title, file);
    const result = resultFromFileName(this.fileName);
    const resultBar = document.createElement("div");
    resultBar.className = `adj-result adj-result-${result.toLowerCase()}`;
    resultBar.textContent = `Result: ${result}`;
    report.append(banner, resultBar);

    const headerCard = card("Header");
    const headerFields = fields(header);
    if (headerFields.length) {
      const grid = document.createElement("div");
      grid.className = "adj-header-grid";
      const left = document.createElement("div");
      const right = document.createElement("div");
      const headings = ["Parameter", "Unit", "Value"];
      const general = headerFields.filter((row) => !/^SDM\b|^Aeff\b/i.test(row[0]));
      const sdm = headerFields.filter((row) => /^SDM\b/i.test(row[0]));
      const aeff = headerFields.filter((row) => /^Aeff\b/i.test(row[0]));
      if (general.length) left.appendChild(table(headings, general));
      if (sdm.length) right.appendChild(table(headings, sdm));
      if (aeff.length) {
        const label = document.createElement("h3");
        label.textContent = "Aeff";
        right.append(label, table(headings, aeff));
      }
      grid.append(left, right);
      headerCard.body.appendChild(grid);
    } else headerCard.body.textContent = "No header data available.";
    report.appendChild(headerCard.element);
    addSection(report, "Conditions", ["Parameter", "Unit", "Value"], fields(section("conditions")));
    const resultRows = (results?.rows ?? []).map((row) => {
      const separator = row[0].lastIndexOf(" - ");
      const [parameter, unit] = splitUnit(separator >= 0 ? row[0].slice(separator + 3) : row[0]);
      return [separator >= 0 ? row[0].slice(0, separator) : "", parameter, unit, row.slice(1).join(" / ")];
    });
    addSection(report, "Results", ["Step", "Parameter", "Unit", "Value"], resultRows);

    const limit = getAeffLimit(header, results);
    const limitCard = card("Limit Test");
    const limitTable = table(["Parameter", "Unit", "Limit Min", "Limit Max", "Value", "Status"], [[
      "Aeff (Meas)", limit.unit || "—", limit.min || "—", limit.max || "—", limit.value || "—", limit.status,
    ]]);
    limitTable.querySelector("tbody tr")?.classList.add(`adj-limit-${limit.status.toLowerCase()}`);
    limitCard.body.appendChild(limitTable);
    report.appendChild(limitCard.element);

    container.appendChild(report);
    try {
      this.addGraph(report, "Pre-Adjustment Graph (Steps 2–4)", measurement, AEFF_SERIES, [2, 3, 4]);
      this.addGraph(report, "Adjustment Graph (Steps 5–7)", measurement, AEFF_SERIES, [5, 6, 7]);
      this.addGraph(report, "Position & Force Graph", measurement, [
        { name: "Position", color: "#22d3ee", axis: "y" },
        { name: "Force", color: "#f472b6", axis: "yPosition" },
      ]);
      this.addMeasurements(report, measurement);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  private addGraph(report: HTMLElement, title: string, measurement: CsvSection | undefined, definitions: GraphSeries[], steps?: number[]) {
    const graph = card(title);
    report.appendChild(graph.element);
    if (!measurement) {
      graph.body.textContent = "No measurement data available.";
      return;
    }
    const hasColumn = (name: string) => measurement.columns.some((column) => column.trim().toLowerCase() === name.toLowerCase());
    if (!hasColumn("Time") || (steps && !hasColumn("Step"))) {
      graph.body.textContent = steps && !hasColumn("Step")
        ? "Step column is missing; the requested phase cannot be plotted."
        : "Time column is missing; measurements cannot be plotted.";
      return;
    }
    const series = measurementSeries(measurement, definitions.map((item) => item.name), steps);
    const missing = definitions.filter((item) => !series.some((entry) => entry.name === item.name));
    if (missing.length) {
      const message = document.createElement("p");
      message.textContent = `Unavailable series: ${missing.map((item) => item.name).join(", ")}.`;
      graph.body.appendChild(message);
    }
    if (!series.some((item) => item.points.some((point) => point.y !== null))) {
      const message = document.createElement("p");
      message.textContent = steps ? "No measurement data available for these steps." : "No measurement data available.";
      graph.body.appendChild(message);
      return;
    }
    const plot = document.createElement("div");
    plot.className = "adj-chart-plot";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", title);
    plot.appendChild(canvas);
    graph.body.appendChild(plot);
    const datasets = series.map((item) => {
      const definition = definitions.find((entry) => entry.name === item.name)!;
      return {
        label: `${item.name} ${item.unit}`.trim(),
        data: item.points,
        borderColor: definition.color,
        backgroundColor: definition.color,
        borderDash: definition.dash,
        yAxisID: definition.axis,
        pointRadius: 0,
        borderWidth: 1.5,
        spanGaps: false,
      };
    });
    const unitFor = (axis: GraphSeries["axis"]) => {
      const definition = definitions.find((item) => item.axis === axis && series.some((entry) => entry.name === item.name));
      const entry = series.find((item) => item.name === definition?.name);
      return entry ? `${axis === "y" && title !== "Position & Force Graph" ? "Aeff" : entry.name} ${entry.unit}`.trim() : "";
    };
    const timeIndex = measurement.columns.findIndex((column) => column.trim().toLowerCase() === "time");
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
            ticks: { color: "#94a3b8" },
            grid: { color: "rgba(148, 163, 184, 0.16)" },
            title: { display: true, text: `Time ${measurement.units[timeIndex] ?? ""}`.trim(), color: "#cbd5e1" },
          },
          y: {
            ticks: { color: "#94a3b8" },
            grid: { color: "rgba(148, 163, 184, 0.16)" },
            title: { display: true, text: unitFor("y"), color: "#cbd5e1" },
          },
          yPosition: {
            position: "right",
            ticks: { color: "#94a3b8" },
            grid: { drawOnChartArea: false, color: "rgba(148, 163, 184, 0.16)" },
            title: { display: true, text: unitFor("yPosition"), color: "#cbd5e1" },
          },
        },
      },
    }));
  }

  private addMeasurements(report: HTMLElement, measurement: CsvSection | undefined) {
    const raw = card("Measurement Raw Data", false);
    report.appendChild(raw.element);
    if (!measurement) {
      raw.body.textContent = "No measurement data available.";
      return;
    }
    const count = document.createElement("p");
    count.textContent = `Number Of Samples: ${measurement.rows.length}`;
    raw.body.append(count, table(measurement.columns, [measurement.columns.map((_, index) => measurement.units[index] ?? "")]));

    const start = /(?:^|\r?\n)\[Measurement\][ \t]*(?:\r?\n|$)/i.exec(this.csvText);
    if (!start) return;
    const offset = start.index + (start[0].startsWith("\n") ? 1 : start[0].startsWith("\r\n") ? 2 : 0);
    const rest = this.csvText.slice(offset);
    const next = /\r?\n\[[^\]\r\n]+\][ \t]*(?:\r?\n|$)/.exec(rest);
    const text = next ? rest.slice(0, next.index) : rest;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "adj-copy";
    button.textContent = "Copy data to Clipboard";
    const status = document.createElement("span");
    status.className = "adj-copy-status";
    status.setAttribute("role", "status");
    button.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
        await navigator.clipboard.writeText(text);
        status.textContent = "Copied to clipboard";
      } catch (error) {
        status.textContent = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    raw.body.append(button, status);
  }

  destroy(): void {
    for (const chart of this.charts) chart.destroy();
    this.charts = [];
  }
}
