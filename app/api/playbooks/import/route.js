// Import playbooks from portable files — a single .md file, or a .zip of
// .md files (e.g. previously exported from here, from Obsidian, or hand
// written). Multipart form upload with one field, "file". Existing
// playbooks are never overwritten by this — every upload becomes a new
// playbook entry (edit/delete duplicates afterward in the UI if needed).
import AdmZip from "adm-zip";
import { addPlaybook, parsePlaybookMarkdown } from "@/lib/playbooks";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB — plenty for text playbooks

function titleFromFilename(filename) {
  return String(filename || "")
    .replace(/\.md$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a 'file' field" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "File too large" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name || "";
  const imported = [];
  const errors = [];

  function importOne(text, fallbackName) {
    try {
      const parsed = parsePlaybookMarkdown(text, titleFromFilename(fallbackName));
      if (!parsed.content) {
        errors.push(`${fallbackName}: no content found`);
        return;
      }
      const entry = addPlaybook({
        category: parsed.category,
        title: parsed.title,
        content: parsed.content,
        tags: parsed.tags,
      });
      imported.push(entry);
    } catch (err) {
      errors.push(`${fallbackName}: ${err.message}`);
    }
  }

  if (name.toLowerCase().endsWith(".zip")) {
    let zip;
    try {
      zip = new AdmZip(buf);
    } catch {
      return Response.json({ error: "Couldn't read that zip file" }, { status: 400 });
    }
    const entries = zip.getEntries().filter((e) => !e.isDirectory && /\.md$/i.test(e.entryName));
    if (entries.length === 0) {
      return Response.json({ error: "No .md files found in that zip" }, { status: 400 });
    }
    for (const entry of entries) {
      importOne(entry.getData().toString("utf-8"), entry.entryName.split("/").pop());
    }
  } else {
    importOne(buf.toString("utf-8"), name || "playbook.md");
  }

  if (imported.length === 0) {
    return Response.json({ error: "Nothing imported", details: errors }, { status: 400 });
  }
  return Response.json({ imported, errors });
}
