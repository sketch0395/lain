// Export saved incident reports as portable files — a single .md for one
// report, or a .zip of .md files for a whole category / the entire
// library. Same pattern as app/api/playbooks/export/route.js.
import AdmZip from "adm-zip";
import { listIncidentReports, reportToMarkdown, reportFilename } from "@/lib/incidentReports";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const category = searchParams.get("category") || null;

  if (id) {
    const entry = listIncidentReports().find((r) => String(r.id) === String(id));
    if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
    const md = reportToMarkdown(entry);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${reportFilename(entry)}"`,
      },
    });
  }

  const entries = listIncidentReports(category);
  if (entries.length === 0) {
    return Response.json({ error: "No incident reports to export" }, { status: 404 });
  }
  const zip = new AdmZip();
  const usedNames = new Set();
  for (const entry of entries) {
    let name = reportFilename(entry);
    if (usedNames.has(name)) {
      name = name.replace(/\.md$/, `-${entry.id}.md`);
    }
    usedNames.add(name);
    zip.addFile(name, Buffer.from(reportToMarkdown(entry), "utf-8"));
  }
  const buf = zip.toBuffer();
  const zipName = category ? `incident-reports-${category}.zip` : "incident-reports.zip";
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
