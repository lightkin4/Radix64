"use client";
import { useCallback, useEffect, useState } from "react";
import { listApps } from "@/lib/api";
import type { AppSummary } from "@/lib/types";
import AppPreview from "./AppPreview";
import Chat from "./Chat";
import Header from "./Header";

export default function Workspace() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [appId, setAppId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const app = apps.find((candidate) => candidate.id === appId) ?? null;

  useEffect(() => {
    listApps().then(setApps, console.error);
  }, []);

  const selectApp = useCallback(
    (id: string | null) => {
      setAppId(id);
      setVersion(apps.find((candidate) => candidate.id === id)?.version ?? 0);
    },
    [apps],
  );

  function onAppCreated(created: AppSummary) {
    setApps((all) => [created, ...all.filter((app) => app.id !== created.id)]);
    setAppId(created.id);
    setVersion(created.version);
  }

  return (
    <div className="workspace">
      <Header apps={apps} selectedAppId={appId} onSelectApp={selectApp} />
      <AppPreview key={`preview-${appId}`} app={app} version={version} />
      <Chat appId={appId} onAppCreated={onAppCreated} onBuild={setVersion} />
    </div>
  );
}
