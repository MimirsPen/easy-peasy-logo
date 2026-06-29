import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppStateProvider } from "./state/AppStateProvider";

createRoot(document.getElementById("root")!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
);
