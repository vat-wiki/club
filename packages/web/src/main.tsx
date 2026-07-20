import { I18nProvider } from "@/lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element <div id='root'> not found in index.html");
}
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);