import { ref } from 'vue';
import GUI from '../js/gui';
import { switchTab } from '../js/tab_switch';
import DeviceHandler from '../js/device_handler';

const pendingHex = ref<File | null>(null);
const error = ref('');
const deviceSelectionOpen = ref(false);

export function takeDdHex(): File | null {
    const file = pendingHex.value;
    pendingHex.value = null;
    return file;
}

export function useDdProgrammer() {
    function findTarget() {
        const devices = [...DeviceHandler.currentUsbPorts, ...DeviceHandler.currentSerialPorts];
        const selected = devices.find(device => device.path === DeviceHandler.devicePicker.selectedDevice);
        if (selected) return selected;
        if (devices.length === 1) {
            DeviceHandler.devicePicker.selectedDevice = devices[0].path;
            return devices[0];
        }
        return null;
    }

    async function selectDevice(protocol: 'serial' | 'usb') {
        error.value = '';
        await DeviceHandler.requestDevicePermission(protocol);
        if (findTarget()) {
            deviceSelectionOpen.value = false;
            chooseHex();
        } else error.value = 'Устройство не выбрано. Разрешите доступ к COM-порту или DFU-устройству.';
    }

    function chooseHex() {
        error.value = '';
        if (GUI.connect_lock || GUI.flashingInProgress || GUI.tab_switch_in_progress) return;
        const target = findTarget();
        if (!target) {
            deviceSelectionOpen.value = true;
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.hex';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            const stillPresent = [...DeviceHandler.currentUsbPorts, ...DeviceHandler.currentSerialPorts]
                .some(device => device.path === target.path);
            if (!stillPresent) {
                error.value = 'Устройство отключено. Подключите полётник и повторите выбор файла.';
                return;
            }
            DeviceHandler.devicePicker.selectedDevice = target.path;
            if (!file.name.toLowerCase().endsWith('.hex')) {
                error.value = 'Выберите файл HEX.';
                return;
            }
            pendingHex.value = file;
            if (!switchTab('firmware_flasher', { mode: 'disconnected' })) {
                pendingHex.value = null;
                error.value = 'Не удалось открыть программатор. Завершите текущую операцию.';
            }
        }, { once: true });
        input.click();
    }
    return { chooseHex, error, deviceSelectionOpen, selectDevice };
}
