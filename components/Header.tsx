import { Separator } from "@/components/ui/separator";
import type { App } from "../server/base44";
import AppSelector from "./AppSelector";

type Props = {
  apps: App[];
  selectedAppId: string | null;
  onSelectApp: (id: string | null) => void;
};

export default function Header({ apps, selectedAppId, onSelectApp }: Props) {
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
    </header>
  );
}
