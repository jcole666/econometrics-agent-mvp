function reportFileBase(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  if (!text) return "分析报告";
  return text.length > 18 ? text.slice(0, 18) : text;
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function saveResultMessage(result: SaveFileResult | undefined, label: string): string {
  if (!result) return "";
  if (result.ok) {
    return result.filePath ? `${label}已导出：${result.filePath}` : `${label}已导出。`;
  }
  if (result.canceled) return "已取消导出。";
  return result.error || `${label}导出失败。`;
}

export async function saveReportMarkdown(report: string, question: string): Promise<string> {
  if (!report.trim()) return "请先生成报告。";

  const fileName = `${reportFileBase(question)}.md`;
  try {
    if (window.workbench?.saveTextFile) {
      const result = await window.workbench.saveTextFile({ fileName, content: report });
      return saveResultMessage(result, "Markdown");
    }

    downloadTextFile(fileName, report);
    return "Markdown 已导出。";
  } catch (error) {
    return error instanceof Error ? error.message : "Markdown 导出失败。";
  }
}

export async function saveReportPdf(report: string, question: string): Promise<string> {
  if (!report.trim()) return "请先生成报告。";
  if (!window.workbench?.saveReportPdf) return "PDF 导出需要在桌面应用中使用。";

  try {
    const result = await window.workbench.saveReportPdf({
      fileName: `${reportFileBase(question)}.pdf`,
      title: question.trim() || "分析报告",
      markdown: report
    });
    return saveResultMessage(result, "PDF");
  } catch (error) {
    return error instanceof Error ? error.message : "PDF 导出失败。";
  }
}
