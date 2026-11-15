import { getAppHtml } from "@/lib/store";

export const dynamic = "force-dynamic";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const placeholder = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>No preview yet</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid; place-items: center; background: #f0fdf4; color: #166534;
        font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; text-align: center; padding: 24px;
      }
    </style>
  </head>
  <body>Your app preview shows up here once the first build finishes.</body>
</html>`;

// Serves the latest build of an app. The `v` query is only a cache buster.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const html = await getAppHtml(id);
  return new Response(html ?? placeholder, { headers });
}
