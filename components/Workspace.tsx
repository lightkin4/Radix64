"use client";
import { useCallback, useEffect, useState } from "react";
import { getSettings, listApps } from "@/lib/api";
import type { AppSummary } from "@/lib/types";
import AppPreview from "./AppPreview";
import Chat from "./Chat";
import GithubImport from "./GithubImport";
import Header from "./Header";
import ModelSettings from "./ModelSettings";
import Terminal from "./Terminal";

export default function Workspace() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [appId, setAppId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [showModels, setShowModels] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [modelVersion, setModelVersion] = useState(0);
  const [kickoff, setKickoff] = useState<{ appId: string; text: string } | null>(
    null,
  );
  const app = apps.find((candidate) => candidate.id === appId) ?? null;

  useEffect(() => {
    listApps().then((all) => {
      setApps(all);
      // Open the most recently edited app so its preview is on screen at start
      // instead of the empty placeholder.
      const latest = all[0];
      if (!latest) return;
      setAppId((current) => current ?? latest.id);
      setVersion((current) => current || latest.version);
    }, console.error);
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

  function onRepoImported(imported: AppSummary) {
    onAppCreated(imported);
    // The first chat turn reads the repository and rebuilds the app from it.
    setKickoff({
      appId: imported.id,
      text: "Rebuild this app from the connected repository.",
    });
  }

  async function openGithub() {
    try {
      setHasToken((await getSettings()).hasGithubToken);
    } catch {
      // The dialog still works; a token is only needed for private repos.
    }
    setShowGithub(true);
  }

  return (
    <div className="workspace">
      <Header
        apps={apps}
        selectedAppId={appId}
        onSelectApp={selectApp}
        onOpenModels={() => setShowModels(true)}
        onOpenGithub={openGithub}
        onOpenTerminal={() => setShowTerminal(true)}
        modelVersion={modelVersion}
      />
      <AppPreview key={`preview-${appId}`} app={app} version={version} />
      <Chat
        appId={appId}
        onAppCreated={onAppCreated}
        onBuild={setVersion}
        kickoff={kickoff}
        onKickoffConsumed={() => setKickoff(null)}
      />

      {showModels && (
        <ModelSettings
          onClose={() => setShowModels(false)}
          onSaved={() => setModelVersion((count) => count + 1)}
        />
      )}
      {showGithub && (
        <GithubImport
          hasToken={hasToken}
          onClose={() => setShowGithub(false)}
          onImported={onRepoImported}
        />
      )}
      {showTerminal && (
        <Terminal
          onClose={() => setShowTerminal(false)}
          onBuilt={(built, builtVersion) => {
            setApps((all) => [
              built,
              ...all.filter((candidate) => candidate.id !== built.id),
            ]);
            setAppId(built.id);
            setVersion(builtVersion);
          }}
        />
      )}
    </div>
  );
}
