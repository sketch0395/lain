import { updateIoc, deleteIoc } from "@/lib/iocs";

export async function PATCH(request, { params }) {
  const { iocId } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const ioc = updateIoc(Number(iocId), { verdict: body.verdict, notes: body.notes }, "user");
    if (!ioc) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ioc });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { iocId } = await params;
  return Response.json({ removed: deleteIoc(Number(iocId)) });
}
