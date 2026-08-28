import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "../styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let isReloadingForUpdate = false;
    const reloadForUpdate = () => {
      if (isReloadingForUpdate) return;
      isReloadingForUpdate = true;
      window.location.reload();
    };

    const requestActivation = (worker) => {
      if (!worker) return;
      worker.postMessage({ type: "SKIP_WAITING" });
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);

    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        const checkForUpdates = () => registration.update().catch(() => {});

        if (registration.waiting) requestActivation(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const nextWorker = registration.installing;
          if (!nextWorker) return;
          nextWorker.addEventListener("statechange", () => {
            if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
              requestActivation(nextWorker);
            }
          });
        });

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdates();
        });
        window.addEventListener("pageshow", checkForUpdates);
        checkForUpdates();
      })
      .catch(() => {});
  });
}
