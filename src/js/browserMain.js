import "../../libraries/flightindicators.css";

import "../css/theme.css";
import "../css/main.less";
import "../css/opensans_webfontkit/fonts.css";
import "../components/MotorOutputReordering/Styles.css";
import "../components/EscDshotDirection/Styles.css";
import "../css/dark-theme.less";
import "./main";

import { i18n } from "./localization";
import { pinia } from "./pinia_instance";
import { useDialogStore } from "../stores/dialog";
import { registerSW } from "virtual:pwa-register";
import { isPwaContext } from "./utils/checkCompatibility.js";
import GUI from "./gui";
import CONFIGURATOR from "./data_storage";
import { ddDumpBusy } from "../composables/ddOperationState";

const localPortable = ["127.0.0.1", "localhost"].includes(location.hostname);
const updateBlocked = () => GUI.connect_lock || GUI.flashingInProgress || CONFIGURATOR.cliActive || ddDumpBusy.value;

if (localPortable) {
    // Portable builds use the local server directly, never an old service-worker cache.
    let checking = false;
    const checkBuild = async () => {
        if (checking || updateBlocked()) return;
        checking = true;
        try {
            if ("serviceWorker" in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));
                if (navigator.serviceWorker.controller) {
                    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
                    location.reload();
                    return;
                }
            }
            const response = await fetch(`/__local_build?t=${Date.now()}`, { cache: "no-store" });
            if (!response.ok) return;
            const html = new DOMParser().parseFromString(await response.text(), "text/html");
            const entry = html.querySelector('script[type="module"][src]')?.getAttribute("src");
            const current = document.querySelector('script[type="module"][src]')?.getAttribute("src");
            if (entry && current && entry !== current && !updateBlocked()) location.reload();
        } catch (error) {
            console.debug("Local build check failed", error);
        } finally {
            checking = false;
        }
    };
    setInterval(checkBuild, 2000);
    window.addEventListener("focus", checkBuild);
    void checkBuild();
} else if (isPwaContext()) {
    const dialogStore = useDialogStore(pinia);
    let refreshPending = false;
    const updateSW = registerSW({
        onRegisteredSW(_url, registration) {
            // Detect rebuilt local files even when the user leaves the window open.
            setInterval(() => {
                if (registration && navigator.onLine) {
                    registration.update().catch((error) => console.debug("App update check failed", error));
                }
            }, 60000);
        },
        onNeedRefresh() {
            if (refreshPending) return;
            refreshPending = true;
            // Never reload while the FC is being flashed or a CLI session is active.
            const refreshWhenIdle = () => {
                if (GUI.connect_lock || GUI.flashingInProgress || CONFIGURATOR.cliActive || ddDumpBusy.value) {
                    setTimeout(refreshWhenIdle, 1000);
                    return;
                }
                updateSW(true).catch((error) => {
                    refreshPending = false;
                    console.error("Automatic app update failed", error);
                });
            };
            setTimeout(refreshWhenIdle, 0);
        },
        onOfflineReady() {
            console.log("Detected onOfflineReady");
            dialogStore.open(
                "InformationDialog",
                {
                    title: i18n.getMessage("pwaOnOfflineReadyTitle"),
                    text: i18n.getMessage("pwaOnOfflineReadyText"),
                    confirmText: i18n.getMessage("OK"),
                },
                { confirm: () => dialogStore.close() },
            );
        },
    });
}
