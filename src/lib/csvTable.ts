import type { CsvSection } from "./csvReport";

export function createCsvTable(sections: CsvSection[]): HTMLElement {
  const container = document.createElement("div");
  container.className = "csv-sections";
  for (const section of sections) {
    const group = document.createElement("section");
    group.className = "csv-section";
    const heading = document.createElement("h2");
    heading.textContent = section.name;
    const scroller = document.createElement("div");
    scroller.className = "csv-table-scroll";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    section.columns.forEach((column, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = [column, section.units[index]].filter(Boolean).join(" ");
      header.appendChild(cell);
    });
    thead.appendChild(header);
    const tbody = document.createElement("tbody");
    const rows = document.createDocumentFragment();
    for (const values of section.rows) {
      const row = document.createElement("tr");
      section.columns.forEach((_, index) => {
        const cell = document.createElement("td");
        cell.textContent = values[index] ?? "";
        row.appendChild(cell);
      });
      rows.appendChild(row);
    }
    tbody.appendChild(rows);
    table.append(thead, tbody);
    scroller.appendChild(table);
    group.append(heading, scroller);
    container.appendChild(group);
  }
  return container;
}
