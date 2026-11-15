import { Separator } from "@/components/ui/separator";
import type { AppSummary } from "@/lib/types";
import AppSelector from "./AppSelector";
import ModelBadge from "./ModelBadge";

type Props = {
  apps: AppSummary[];
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
      <ModelBadge />
    </header>
  );
}
