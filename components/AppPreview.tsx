"use client";
import type { AppSummary } from "@/lib/types";

// Shows the latest build of the selected app. The version in the URL reloads
// the frame whenever a new build lands.
export default function AppPreview({
  app,
  version,
}: {
  app: AppSummary | null;
  version: number;
}) {
  if (!app) {
    return (
      <main className="preview">
        <p className="preview-message">
          Describe your app in the chat — it shows up here.
        </p>
      </main>
    );
  }

  const src = `/api/apps/${app.id}/preview?v=${version}`;

  return (
    <main className="preview">
      <iframe
        key={src}
        src={src}
        title={app.name}
        className="preview-frame"
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
      />
    </main>
  );
}
