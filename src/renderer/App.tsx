import { ContextMenuProvider } from "./workbench/menu/context-menu";
import { AppView } from "./app/AppView";
import { useAppController } from "./app/use-app-controller";


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
