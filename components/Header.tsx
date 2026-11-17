import { GithubIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AppSummary } from "@/lib/types";
import AppSelector from "./AppSelector";
import ModelBadge from "./ModelBadge";

type Props = {
  apps: AppSummary[];
  selectedAppId: string | null;
  onSelectApp: (id: string | null) => void;
  onOpenModels: () => void;
  onOpenGithub: () => void;
  onOpenTerminal: () => void;
  modelVersion: number;
};

export default function Header({
  apps,
  selectedAppId,
  onSelectApp,
  onOpenModels,
  onOpenGithub,
  onOpenTerminal,
  modelVersion,
}: Props) {
  return (
    <header className="header">
      {/* Radix64 text logo — green on dark */}
      <span className="header-logo-text">Radix64</span>
      <Separator orientation="vertical" className="header-divider" />
      <AppSelector
        apps={apps}
        selectedAppId={selectedAppId}
        onSelectApp={onSelectApp}
      />
      <div className="header-actions">
        <Button
          variant="ghost"
          size="sm"
          className="header-button"
          onClick={onOpenGithub}
        >
          <GithubIcon />
          Read a repo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="header-button"
          onClick={onOpenTerminal}
        >
          <TerminalIcon />
          Terminal
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="header-button"
          onClick={onOpenModels}
        >
          <SlidersHorizontalIcon />
          Model
        </Button>
        <ModelBadge refreshKey={modelVersion} />
      </div>
    </header>
  );
}
