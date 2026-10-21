import GUI from "../js/gui";
import CONFIGURATOR from "../js/data_storage";
import DeviceHandler from "../js/device_handler";
import { disconnect } from "../js/serial_backend";

export async function disconnectAfterSuccess() {
    DeviceHandler.devicePicker.autoConnect = false;
    GUI.connect_lock = false;
    disconnect();
    const deadline = Date.now() + 15000;
    while (CONFIGURATOR.connectionValid || GUI.connected_to || GUI.connecting_to) {
        if (Date.now() > deadline) throw new Error("Операция выполнена, но отключение полётника не завершилось.");
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
