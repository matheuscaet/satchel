import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { applyStoredTheme } from "./state/theme";
import { popoutIdFromUrl } from "./features/response/popout/transport";

applyStoredTheme();

// The same bundle serves the main window and pop-out response windows (`/?popout=<id>`).
// Each loads only its own code: a response window doesn't need the whole app.
const popoutId = popoutIdFromUrl();
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (popoutId) {
  void import("./features/response/popout/ResponseWindow").then(({ ResponseWindowApp }) =>
    root.render(
      <React.StrictMode>
        <ResponseWindowApp id={popoutId} />
      </React.StrictMode>,
    ),
  );
} else {
  void import("./App").then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
