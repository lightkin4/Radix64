import { deleteApp, getApp } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const app = await getApp(id);
  if (!app) return Response.json({ error: "App not found." }, { status: 404 });
  return Response.json({ app });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await deleteApp(id);
  if (!removed) return Response.json({ error: "App not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
