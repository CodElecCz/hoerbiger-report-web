import Chart from "chart.js/auto";
import type { CsvSection } from "./csvReport";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#d97706", "#0891b2"];

function numberValue(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/^([-+]?\d+),(\d+)$/, "$1.$2");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export class AdjReportViewer {
  private charts: Chart[] = [];

  constructor(private sections: CsvSection[]) {}

  render(container: HTMLElement): void {
    const report = document.createElement("div");
    report.className = "adj-report";
    const results = this.sections.find((section) => section.name.toLowerCase() === "results");
    const heading = document.createElement("h2");
    heading.textContent = "Results";
    report.appendChild(heading);
    if (results?.rows.length) {
      const cards = document.createElement("div");
      cards.className = "report-cards";
      for (const row of results.rows) {
        const card = document.createElement("div");
        card.className = "report-card";
        const label = document.createElement("span");
        label.textContent = row[0];
        const value = document.createElement("strong");
        value.textContent = row.slice(1).join(" / ");
        card.append(label, value);
        cards.appendChild(card);
      }
      report.appendChild(cards);
    } else {
      const message = document.createElement("p");
      message.textContent = "No results section found.";
      report.appendChild(message);
    }

    const measurement = this.sections.find((section) => section.name.toLowerCase() === "measurement");
    const timeIndex = measurement?.columns.findIndex((column) => column.trim().toLowerCase() === "time") ?? -1;
    if (!measurement || timeIndex < 0 || !measurement.rows.length) {
      const message = document.createElement("p");
      message.textContent = "No time-series measurements available.";
      report.appendChild(message);
      container.appendChild(report);
      return;
    }

    const groups = new Map<string, number[]>();
    measurement.columns.forEach((column, index) => {
      if (index === timeIndex || !column.trim()) return;
      const unit = measurement.units[index]?.trim() || "Other";
      const indices = groups.get(unit) ?? [];
      indices.push(index);
      groups.set(unit, indices);
    });
    const charts: { canvas: HTMLCanvasElement; unit: string; indices: number[] }[] = [];
    for (const [unit, indices] of groups) {
      const group = document.createElement("section");
      group.className = "report-chart";
      const title = document.createElement("h3");
      title.textContent = unit === "Other" ? "Measurements" : `Measurements ${unit}`;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${title.textContent} over time`);
      const plot = document.createElement("div");
      plot.className = "report-chart-plot";
      plot.appendChild(canvas);
      group.append(title, plot);
      report.appendChild(group);
      charts.push({ canvas, unit, indices });
    }
    if (!charts.length) {
      const message = document.createElement("p");
      message.textContent = "No measurement series available.";
      report.appendChild(message);
    }
    container.appendChild(report);
    try {
      for (const { canvas, unit, indices } of charts) {
        const datasets = indices.map((index, colorIndex) => ({
          label: measurement.columns[index],
          data: measurement.rows.flatMap((row) => {
            const x = numberValue(row[timeIndex]);
            return x === null ? [] : [{ x, y: numberValue(row[index]) }];
          }),
          borderColor: COLORS[colorIndex % COLORS.length],
          backgroundColor: COLORS[colorIndex % COLORS.length],
          pointRadius: 0,
          borderWidth: 1.5,
          spanGaps: false,
        }));
        this.charts.push(new Chart(canvas, {
          type: "line",
          data: { datasets },
          options: {
            animation: false,
            parsing: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { type: "linear", title: { display: true, text: `Time ${measurement.units[timeIndex] ?? ""}`.trim() } },
              y: { title: { display: true, text: unit } },
            },
          },
        }));
      }
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy(): void {
    for (const chart of this.charts) chart.destroy();
    this.charts = [];
  }
}
