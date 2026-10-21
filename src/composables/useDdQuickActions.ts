import { computed, ref } from 'vue';
import GUI from '../js/gui';
import FC from '../js/fc';
import CONFIGURATOR from '../js/data_storage';
import DeviceHandler from '../js/device_handler';
import { connectDisconnect } from '../js/serial_backend';
import { switchTab } from '../js/tab_switch';
import MSP from '../js/msp';
import MSPCodes from '../js/msp/MSPCodes';
import { ddDumpBusy } from './ddOperationState';

type Action = 'gyro' | 'acc' | 'cli';
const running = ref(false);
const message = ref('');
const opened = ref(false);
const needsPort = ref(false);
const accConfirmation = ref(false);
const pending = ref<Action | null>(null);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(test: () => boolean, timeout: number) {
    const deadline = Date.now() + timeout;
    while (!test()) {
        if (Date.now() >= deadline) throw new Error('Операция заняла слишком много времени. Проверьте подключение полётника.');
        await wait(100);
    }
}

async function request(code: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            MSP.promise(code),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Полётник не ответил. Результат команды неизвестен. Проверьте связь перед повтором.')), 10000); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export function useDdQuickActions() {
    const busy = computed(() => running.value || ddDumpBusy.value);

    async function perform(action: Action) {
        if (busy.value || GUI.connect_lock || GUI.flashingInProgress || GUI.tab_switch_in_progress) return;
        opened.value = true;
        message.value = '';
        if (action !== 'gyro' && !CONFIGURATOR.connectionValid) {
            const ports = DeviceHandler.currentSerialPorts;
            const selected = ports.find(device => device.path === DeviceHandler.devicePicker.selectedDevice);
            if (!selected && ports.length === 1) DeviceHandler.devicePicker.selectedDevice = ports[0].path;
            else if (!selected) {
                pending.value = action;
                needsPort.value = true;
                return;
            }
        }
        running.value = true;
        ddDumpBusy.value = true;
        let locked = false;
        try {
            if (action === 'gyro') {
                if (location.origin !== 'http://127.0.0.1:8080') throw new Error('Запустите локальную версию через Запустить.cmd.');
                if (CONFIGURATOR.cliActive) throw new Error('Сначала выйдите из CLI, затем повторите запуск монитора.');
                if (GUI.connecting_to) throw new Error('Дождитесь завершения подключения и повторите запуск монитора.');
                DeviceHandler.devicePicker.autoConnect = false;
                if (GUI.connected_to) {
                    connectDisconnect();
                    await waitFor(() => !GUI.connected_to && !GUI.connecting_to, 15000);
                    await wait(500);
                }
                GUI.connect_lock = true;
                locked = true;
                message.value = 'Монитор открыт в отдельном окне. Выберите COM-порт. C — калибровка, S — сохранить. Не двигайте плату при калибровке. Для возврата закройте монитор (Q). Подключение в конфигураторе заблокировано до закрытия монитора.';
                const response = await fetch('/__local_tools/gyro', { method: 'POST', headers: { 'X-Local-Tool': 'gyro-monitor' } });
                if (response.status === 405 || response.status === 404) throw new Error('Работает старая версия локального сервера. Снова откройте Запустить.cmd и повторите запуск монитора.');
                if (!response.ok) throw new Error(`Ошибка запуска монитора (HTTP ${response.status}). Проверьте сообщение в его окне и наличие Python с pyserial.`);
                message.value = 'Монитор закрыт. Можно снова подключаться к полётнику. Автоподключение оставлено выключенным.';
                return;
            }
            if (!CONFIGURATOR.connectionValid) {
                message.value = 'Подключение к полётнику…';
                connectDisconnect();
                await waitFor(() => CONFIGURATOR.connectionValid, 45000);
                await waitFor(() => !GUI.tab_switch_in_progress, 10000);
            }
            if (action === 'cli') {
                if (GUI.active_tab !== 'cli' && !switchTab('cli', { mode: 'cli' })) throw new Error('Не удалось открыть CLI.');
                opened.value = false;
                return;
            }
            if (CONFIGURATOR.cliActive) throw new Error('Перед калибровкой выйдите из CLI.');
            GUI.connect_lock = true;
            locked = true;
            await request(MSPCodes.MSP_STATUS);
            if (FC.CONFIG.mode & 1) throw new Error('Сначала выключите ARM. Калибровка запрещена на вооружённом полётнике.');
            if (!(FC.CONFIG.activeSensors & 1)) throw new Error('Акселерометр не обнаружен или отключён в прошивке.');
            message.value = 'Калибровка акселерометра… Не двигайте плату.';
            await request(MSPCodes.MSP_ACC_CALIBRATION);
            await wait(2500);
            if (!CONFIGURATOR.connectionValid) throw new Error('Связь потеряна. Результат калибровки не подтверждён.');
            await request(MSPCodes.MSP_BOARD_INFO);
            if (FC.CONFIG.configurationProblems & (1 << FC.CONFIGURATION_PROBLEM_FLAGS.ACC_NEEDS_CALIBRATION)) throw new Error('Прошивка всё ещё сообщает о необходимости калибровки акселерометра.');
            message.value = 'Команда калибровки акселерометра выполнена. Проверьте положение модели на вкладке датчиков.';
        } catch (error) {
            message.value = (error as Error).message;
        } finally {
            if (locked) GUI.connect_lock = false;
            running.value = false;
            ddDumpBusy.value = false;
        }
    }

    async function selectPort() {
        await DeviceHandler.requestDevicePermission('serial');
        if (!DeviceHandler.currentSerialPorts.some(device => device.path === DeviceHandler.devicePicker.selectedDevice)) {
            message.value = 'COM-порт не выбран. Нужен обычный режим работы, не DFU.';
            return;
        }
        needsPort.value = false;
        const action = pending.value;
        pending.value = null;
        if (action) await perform(action);
    }

    return { busy, opened, message, needsPort, accConfirmation, perform, selectPort };
}
