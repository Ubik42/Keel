import { ContextMenuProvider } from "./workbench/menu/context-menu";
import { AppView } from "./app/shell/AppView";
import { useAppController } from "./app/shell/use-app-controller";


function AppInner() {
  const controller = useAppController();
  return <AppView {...controller} />;
}

export function App() {
  return (
    <ContextMenuProvider>
      <AppInner />
    </ContextMenuProvider>
  );
}
