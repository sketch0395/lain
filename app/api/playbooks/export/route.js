// Export the playbook library as portable files — a single .md for one
// playbook, or a .zip of .md files for a whole category / the entire
// library. Lets the user back up, edit in a real editor/Obsidian, or hand
// a playbook to someone else without going through this UI. Companion to
// app/api/playbooks/import/route.js which reads the same shapes back in.
import AdmZip from "adm-zip";
import { listPlaybooks, playbookToMarkdown, playbookFilename } from "@/lib/playbooks";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const category = searchParams.get("category") || null;

  if (id) {
    const entry = listPlaybooks().find((p) => String(p.id) === String(id));
    if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
    const md = playbookToMarkdown(entry);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${playbookFilename(entry)}"`,
      },
    });
  }

  const entries = listPlaybooks(category);
  if (entries.length === 0) {
    return Response.json({ error: "No playbooks to export" }, { status: 404 });
  }
  const zip = new AdmZip();
  const usedNames = new Set();
  for (const entry of entries) {
    let name = playbookFilename(entry);
    // Guard against two playbooks slugging to the same filename.
    if (usedNames.has(name)) {
      name = name.replace(/\.md$/, `-${entry.id}.md`);
    }
    usedNames.add(name);
    zip.addFile(name, Buffer.from(playbookToMarkdown(entry), "utf-8"));
  }
  const buf = zip.toBuffer();
  const zipName = category ? `playbooks-${category}.zip` : "playbooks.zip";
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
