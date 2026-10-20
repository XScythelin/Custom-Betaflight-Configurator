import { ref } from 'vue';
import { ddDumpBusy } from './ddOperationState';
import GUI, { TABS } from '../js/gui';
import FC from '../js/fc';
import CONFIGURATOR from '../js/data_storage';
import DeviceHandler from '../js/device_handler';
import { connectDisconnect } from '../js/serial_backend';
import { send, isMspCliSupported, scheduleReconnect } from './useMspCliSession';
import { switchTab } from '../js/tab_switch';
import { compareDump, dumpCommands } from '../js/utils/ddDumpComparison';

const busy = ddDumpBusy;
const opened = ref(false);
const status = ref('');
const report = ref('');
const dumpDeviceSelectionOpen = ref(false);
const deviceError = ref('');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitConnected(timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (CONFIGURATOR.connectionValid) return;
        await wait(250);
    }
    throw new Error('Не удалось подключиться к полётнику за 45 секунд. Проверьте порт и подключение.');
}

export function useDdDump() {
    async function selectDumpDevice() {
        deviceError.value = '';
        await DeviceHandler.requestDevicePermission('serial');
        const selected = DeviceHandler.currentSerialPorts.find(device => device.path === DeviceHandler.devicePicker.selectedDevice);
        if (selected) {
            dumpDeviceSelectionOpen.value = false;
            chooseDump();
        }
        else deviceError.value = 'COM-порт не выбран. Для дампа полётник должен работать в обычном режиме, не DFU.';
    }

    async function apply(file: File) {
        if (busy.value || GUI.connect_lock || GUI.flashingInProgress) return;
        busy.value = true;
        opened.value = true;
        report.value = '';
        const errors: string[] = [];
        const autoConnect = DeviceHandler.devicePicker.autoConnect;
        let locked = false;
        try {
            const text = await file.text();
            const commands = dumpCommands(text);
            if (!commands.length) throw new Error('Файл не содержит CLI-команд.');
            const saves = commands.map((command, index) => command === 'save' ? index : -1).filter(index => index >= 0);
            if (saves.length > 1 || (saves.length === 1 && saves[0] !== commands.length - 1)) {
                throw new Error('save допускается только один раз в конце файла.');
            }
            status.value = 'Подключение к полётнику…';
            if (!CONFIGURATOR.connectionValid) {
                const selected = DeviceHandler.currentSerialPorts.find(device => device.path === DeviceHandler.devicePicker.selectedDevice);
                if (!selected) {
                    dumpDeviceSelectionOpen.value = true;
                    throw new Error('Полётник не обнаружен или отключён. Выберите USB COM-порт и повторите загрузку дампа.');
                }
                connectDisconnect();
                await waitConnected();
            }
            if (!isMspCliSupported()) throw new Error('Для этой операции нужна прошивка с MSP CLI (Betaflight 4.5.4 или новее).');
            const identity = FC.CONFIG.deviceIdentifier;
            if (!identity) throw new Error('Не удалось определить идентификатор полётника.');
            const toApply = commands.filter(command => command !== 'save');
            status.value = 'Открытие штатного CLI…';
            if (GUI.active_tab !== 'cli' && !switchTab('cli', { mode: 'cli' })) throw new Error('Не удалось открыть CLI.');
            const cliDeadline = Date.now() + 30000;
            while (Date.now() < cliDeadline && (!TABS.cli?.ddSession?.state.startProcessing || !TABS.cli?.ddSession?.isDdReady())) await wait(100);
            const cli = TABS.cli?.ddSession;
            if (!cli?.state.startProcessing || !cli.isDdReady()) throw new Error('CLI не готов к загрузке файла.');
            GUI.connect_lock = true;
            locked = true;
            cli.clearHistory();
            status.value = `Отправка ${toApply.length} CLI-команд…`;
            await cli.executeCommands(toApply.join('\n'));
            await wait(500);
            const responseDeadline = Date.now() + 15000;
            while (Date.now() < responseDeadline && Date.now() - cli.state.lastArrival < 500) await wait(100);
            if (Date.now() - cli.state.lastArrival < 500) throw new Error('CLI не завершил вывод после загрузки.');
            const rejected = cli.getOutputHistory().split(/\r?\n/).filter((line: string) => /###\s*ERROR|UNKNOWN COMMAND/i.test(line));
            if (rejected.length) {
                errors.push(...rejected);
                throw new Error('Прошивка отклонила команды. save не выполнен; часть настроек могла измениться в RAM.');
            }
            status.value = 'Сохранение и перезагрузка…';
            DeviceHandler.devicePicker.autoConnect = true;
            GUI.connect_lock = false;
            locked = false;
            cli.sendLine('save');
            scheduleReconnect();
            // Let the scheduled disconnect run before accepting a new handshake.
            await wait(1500);
            await waitConnected();
            if (FC.CONFIG.deviceIdentifier !== identity) throw new Error('После перезагрузки подключён другой полётник. Проверка отменена.');
            GUI.connect_lock = true;
            locked = true;
            status.value = 'Чтение version и dump all после перезагрузки…';
            const after: string[] = await send('version', { timeoutMs: 10000 });
            const dump: string[] = await send('dump all', { timeoutMs: 60000 });
            if (!dump.some(line => /^set \w+\s*=/.test(line.trim()))) throw new Error('Не получен полноценный dump all; проверка невозможна.');
            const comparison = compareDump(text, dump.join('\n'));
            const checked = comparison.matched.length + comparison.mismatched.length;
            report.value = `Файл: ${file.name}\nОтправлено CLI-команд: ${toApply.length} + save\n\nВерсия установленной прошивки (version):\n${after.join('\n')}\n\nПроверено итоговых параметров: ${checked}\nСовпало: ${comparison.matched.length}\nРасхождений: ${comparison.mismatched.length}\nКоманд без автоматической проверки: ${comparison.unchecked.length}\n\n${comparison.mismatched.join('\n')}\n\nНе проверенные автоматически команды:\n${comparison.unchecked.join('\n')}\n\nСчитанный dump all:\n${dump.join('\n')}`;
            status.value = comparison.mismatched.length ? 'Есть расхождения.' : comparison.unchecked.length ? 'Проверенные параметры совпали. Проверка неполная — см. список команд.' : 'Все сравниваемые параметры совпали после перезагрузки.';
        } catch (error) {
            status.value = 'Операция не завершена успешно.';
            report.value += `\n${String((error as Error)?.message ?? error)}\n${errors.join('\n')}`;
        } finally {
            if (locked) GUI.connect_lock = false;
            DeviceHandler.devicePicker.autoConnect = autoConnect;
            busy.value = false;
        }
    }

    function chooseDump() {
        if (busy.value || GUI.connect_lock || GUI.flashingInProgress) return;
        deviceError.value = '';
        if (!CONFIGURATOR.connectionValid) {
            const ports = DeviceHandler.currentSerialPorts;
            const selected = ports.find(device => device.path === DeviceHandler.devicePicker.selectedDevice);
            if (!selected && ports.length === 1) DeviceHandler.devicePicker.selectedDevice = ports[0].path;
            else if (!selected) {
                dumpDeviceSelectionOpen.value = true;
                return;
            }
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.diff,.dump,.cli';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) void apply(file);
        }, { once: true });
        input.click();
    }
    return { chooseDump, busy, opened, status, report, dumpDeviceSelectionOpen, selectDumpDevice, deviceError };
}
