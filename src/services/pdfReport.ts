import { formatMoney } from "../domain/money";
import { reportFileName, type ReportModel } from "../domain/report";

export async function generatePdfReport(model: ReportModel) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  doc.setTextColor(20, 25, 35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Gastos Simples", margin, 14);
  doc.setFontSize(12);
  doc.text("Relatório financeiro", margin, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Perfil: ${model.filters.profile}`, margin, 28);
  doc.text(`Período: ${model.filters.from} a ${model.filters.to}`, margin, 33);
  doc.text(`Categoria: ${model.filters.category}`, margin, 38);
  doc.text(`Emitido em: ${model.issuedAt.toLocaleString("pt-BR")}`, margin, 43);
  const t = model.totals;
  const summary: Array<[string, string]> = [
    ["Receitas previstas", formatMoney(t.incomePlanned)], ["Receitas recebidas", formatMoney(t.incomeRealized)],
    ["Despesas previstas", formatMoney(t.expensePlanned)], ["Despesas pagas", formatMoney(t.expenseRealized)],
    ["Saldo previsto", formatMoney(t.plannedBalance)], ["Saldo realizado", formatMoney(t.realizedBalance)],
    ["A receber", formatMoney(t.toReceive)], ["A pagar", formatMoney(t.toPay)],
  ];
  autoTable(doc, {
    startY: 48,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, textColor: [20, 25, 35], fillColor: [255, 255, 255], cellPadding: 2 },
    headStyles: { fillColor: [235, 242, 247], textColor: [20, 25, 35], fontStyle: "bold" },
    head: [summary.map(([label]) => label)],
    body: [summary.map(([, value]) => value)],
  });
  autoTable(doc, {
    startY: 68,
    margin: { left: margin, right: margin, bottom: 14 },
    theme: "grid",
    showHead: "everyPage",
    styles: { font: "helvetica", fontSize: 8, overflow: "linebreak", textColor: [20, 25, 35], fillColor: [255, 255, 255], cellPadding: 2 },
    headStyles: { fillColor: [0, 93, 136], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 30 }, 2: { cellWidth: 60 }, 3: { cellWidth: 38 }, 4: { cellWidth: 22 }, 5: { cellWidth: 24 }, 6: { cellWidth: 30, halign: "right" } },
    head: [["Data", "Perfil", "Descrição", "Categoria", "Tipo", "Situação", "Valor"]],
    body: model.rows.map((row) => [row.date, row.profile, row.description, row.category, row.type, row.status, row.value]),
    didDrawPage: () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60, 65, 75);
      doc.text(`Página ${doc.getNumberOfPages()} de {total_pages_count_string}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    },
  });
  doc.putTotalPages("{total_pages_count_string}");
  doc.save(reportFileName(model));
}
