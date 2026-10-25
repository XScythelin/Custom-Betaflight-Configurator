import { computed, ref } from "vue";
import GUI from "../js/gui";
import FC from "../js/fc";
import CONFIGURATOR from "../js/data_storage";
import DeviceHandler from "../js/device_handler";
import { connectDisconnect } from "../js/serial_backend";
import { switchTab } from "../js/tab_switch";
import MSP from "../js/msp";
import MSPCodes from "../js/msp/MSPCodes";
import { ddDumpBusy } from "./ddOperationState";
import { calibrateAndSaveGyro } from "./useDdGyroCalibration";
import { calibrateAndSaveBaro } from "./useDdBaroCalibration";
import { disconnectAfterSuccess } from "./ddDisconnect";
import { send, isMspCliSupported } from "./useMspCliSession";
import { settingAcknowledged, streamSettingsFromDump } from "./ddCliSettings";

type Action =
    | "gyro"
    | "gyroInject"
    | "acc"
    | "cli"
    | "gyroCalibrate"
    | "gyroAutoOff"
    | "gyroAutoOn"
    | "streamUsb"
    | "streamRestore"
    | "baroCalibrate"
    | "baroAutoOn"
    | "baroAutoOff";
const running = ref(false);
const message = ref("");
const opened = ref(false);
const needsPort = ref(false);
const accConfirmation = ref(false);
const gyroConfirmation = ref(false);
const baroConfirmation = ref(false);
const replies = ref("");
const pending = ref<Action | null>(null);
let streamSettings: Map<string, string> | null = null;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(test: () => boolean, timeout: number) {
    const deadline = Date.now() + timeout;
    while (!test()) {
        if (Date.now() >= deadline)
            throw new Error("Операция заняла слишком много времени. Проверьте подключение полётника.");
        await wait(100);
    }
}

async function request(code: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const response = await Promise.race([
            MSP.promise(code),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                "Полётник не ответил. Результат команды неизвестен. Проверьте связь перед повтором.",
                            ),
                        ),
                    10000,
                );
            }),
        ]);
        if (response?.unsupported) throw new Error("Команда не поддерживается прошивкой.");
    } finally {
        clearTimeout(timer);
    }
}

export function useDdQuickActions() {
    const busy = computed(() => running.value || ddDumpBusy.value);

    async function perform(action: Action) {
        if (busy.value || GUI.connect_lock || GUI.flashingInProgress || GUI.tab_switch_in_progress) return;
        opened.value = true;
        message.value = "";
        replies.value = "";
        if (action !== "gyro" && action !== "gyroInject" && !CONFIGURATOR.connectionValid) {
            const ports = DeviceHandler.currentSerialPorts;
            const selected = ports.find((device) => device.path === DeviceHandler.devicePicker.selectedDevice);
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
            if (action === "gyro" || action === "gyroInject") {
                const injecting = action === "gyroInject";
                if (location.origin !== "http://127.0.0.1:8080")
                    throw new Error("Запустите локальную версию через Запустить.cmd.");
                if (CONFIGURATOR.cliActive) throw new Error("Сначала выйдите из CLI, затем повторите запуск монитора.");
                if (GUI.connecting_to) throw new Error("Дождитесь завершения подключения и повторите запуск монитора.");
                DeviceHandler.devicePicker.autoConnect = false;
                if (GUI.connected_to) {
                    connectDisconnect();
                    await waitFor(() => !GUI.connected_to && !GUI.connecting_to, 15000);
                    await wait(500);
                }
                GUI.connect_lock = true;
                locked = true;
                message.value = injecting
                    ? "Выбор смещения открыт в отдельном окне. Снимите пропеллеры. Только стенд: с внесённой ошибкой нельзя армить и летать. Закройте окно утилиты для возврата. Подключение заблокировано до закрытия окна."
                    : "Монитор открыт в отдельном окне. Выберите COM-порт. C — калибровка, S — сохранить. Не двигайте плату при калибровке. Для возврата закройте монитор (Q). Подключение в конфигураторе заблокировано до закрытия монитора.";
                const response = await fetch(injecting ? "/__local_tools/gyro-inject" : "/__local_tools/gyro", {
                    method: "POST",
                    headers: { "X-Local-Tool": injecting ? "gyro-inject" : "gyro-monitor" },
                });
                if (response.status === 405 || response.status === 404)
                    throw new Error(
                        "Работает старая версия локального сервера. Снова откройте Запустить.cmd и повторите запуск монитора.",
                    );
                if (!response.ok)
                    throw new Error(
                        `Ошибка запуска монитора (HTTP ${response.status}). Проверьте сообщение в его окне и наличие Python с pyserial.`,
                    );
                message.value =
                    "Окно утилиты закрыто. Автоподключение оставлено выключенным. Результат операции смотрите в окне утилиты; при внесённой ошибке нельзя армить и летать.";
                return;
            }
            if (!CONFIGURATOR.connectionValid) {
                message.value = "Подключение к полётнику…";
                connectDisconnect();
                await waitFor(() => CONFIGURATOR.connectionValid, 45000);
                await waitFor(() => !GUI.tab_switch_in_progress, 10000);
            }
            if (action === "cli") {
                if (GUI.active_tab !== "cli" && !switchTab("cli", { mode: "cli" }))
                    throw new Error("Не удалось открыть CLI.");
                opened.value = false;
                return;
            }
            if (CONFIGURATOR.cliActive) throw new Error("Перед калибровкой выйдите из CLI.");
            GUI.connect_lock = true;
            locked = true;
            await request(MSPCodes.MSP_STATUS);
            if (FC.CONFIG.mode & 1)
                throw new Error("Сначала выключите ARM. Калибровка запрещена на вооружённом полётнике.");
            if (action === "gyroCalibrate") {
                message.value = "Калибровка гироскопа… Не двигайте плату. Ожидание ответа.";
                await calibrateAndSaveGyro((stage, values) => {
                    replies.value += `${stage === "calibrate" ? "Калибровка" : "Сохранение"}: получен успешный ответ\n${values.map((axes, i) => `G${i}: ${axes.join(", ")}`).join("\n")}\n`;
                    message.value =
                        stage === "calibrate"
                            ? "Калибровка подтверждена. Сохранение во flash…"
                            : "Калибровка и сохранение подтверждены полётником.";
                });
                await disconnectAfterSuccess();
                message.value = "Калибровка и сохранение подтверждены полётником. Полётник отключён.";
                return;
            }
            if (action === "baroCalibrate") {
                if (!(FC.CONFIG.activeSensors & 2)) throw new Error("Барометр не обнаружен или отключён в прошивке.");
                message.value = "Калибровка барометра… Не двигайте плату, избегайте потоков воздуха.";
                await calibrateAndSaveBaro((stage, result) => {
                    replies.value += `${stage === "calibrate" ? "Калибровка" : "Сохранение"} барометра: получен успешный ответ\nДавление: ${result.pressurePa} Па; высота нуля: ${result.altitudeCm / 100} м; отсчётов: ${result.samples}\n`;
                    message.value =
                        stage === "calibrate"
                            ? "Калибровка подтверждена. Сохранение в EEPROM…"
                            : "Сохранение барометра подтверждено.";
                });
                await disconnectAfterSuccess();
                message.value = "Калибровка и сохранение барометра подтверждены. Полётник отключён.";
                return;
            }
            if (
                action === "gyroAutoOff" ||
                action === "gyroAutoOn" ||
                action === "baroAutoOn" ||
                action === "baroAutoOff" ||
                action === "streamUsb" ||
                action === "streamRestore"
            ) {
                if (!isMspCliSupported()) throw new Error("Прошивка не поддерживает MSP CLI.");
                const baroAction = action === "baroAutoOn" || action === "baroAutoOff";
                const value = action === "gyroAutoOn" || action === "baroAutoOn" ? "ON" : "OFF";
                const settings =
                    action === "streamRestore"
                        ? streamSettings
                        : action === "streamUsb"
                          ? new Map([
                                ["msp_telemetry_stream_port", "20"],
                                ["serialrx_halfduplex", "OFF"],
                                ["serial_update_rate_hz", "1000"],
                            ])
                          : new Map([[baroAction ? "baro_use_saved_zero" : "gyro_cal_on_startup", value]]);
                if (!settings?.size) throw new Error("Сначала выберите файл дампа с настройками стриминга.");
                message.value = "Применение настроек…";
                for (const [name, setting] of settings) {
                    const lines = (await send(`set ${name} = ${setting}`, { timeoutMs: 10000 })) as string[];
                    replies.value += `${lines.join("\n")}\n`;
                    if (!settingAcknowledged(lines, name, setting))
                        throw new Error(
                            `Изменение ${name} не подтверждено. Сохранение отменено; часть параметров могла измениться в RAM.`,
                        );
                }
                // Keep the link alive for the save acknowledgement, then disconnect explicitly.
                const saved = (await send("save noreboot", { timeoutMs: 10000 })) as string[];
                replies.value += `\n${saved.join("\n")}`;
                if (
                    saved.some((line) => /ERROR|FAILED|UNKNOWN|Wait for/i.test(line)) ||
                    !saved.some((line) => /#\s*saving/i.test(line))
                )
                    throw new Error("Нет подтверждения сохранения параметра.");
                await disconnectAfterSuccess();
                message.value =
                    action === "streamUsb"
                        ? "Стриминг на USB включён. Сохранение подтверждено. Полётник отключён."
                        : action === "streamRestore"
                          ? "Настройки стриминга из дампа сохранены. Полётник отключён."
                          : baroAction
                            ? `Использование сохранённого нуля барометра ${value === "ON" ? "включено" : "отключено"}. Сохранение подтверждено. Полётник отключён.`
                            : `Автокалибровка гироскопа ${value === "ON" ? "включена" : "отключена"}. Сохранение подтверждено. Полётник отключён.`;
                return;
            }
            if (!(FC.CONFIG.activeSensors & 1)) throw new Error("Акселерометр не обнаружен или отключён в прошивке.");
            message.value = "Калибровка акселерометра… Не двигайте плату.";
            await request(MSPCodes.MSP_ACC_CALIBRATION);
            await wait(2500);
            if (!CONFIGURATOR.connectionValid) throw new Error("Связь потеряна. Результат калибровки не подтверждён.");
            await request(MSPCodes.MSP_BOARD_INFO);
            if (FC.CONFIG.configurationProblems & (1 << FC.CONFIGURATION_PROBLEM_FLAGS.ACC_NEEDS_CALIBRATION))
                throw new Error("Прошивка всё ещё сообщает о необходимости калибровки акселерометра.");
            message.value =
                "Команда калибровки акселерометра выполнена. Проверьте положение модели на вкладке датчиков.";
            await disconnectAfterSuccess();
            message.value = "Калибровка акселерометра выполнена. Полётник отключён.";
        } catch (error) {
            message.value = (error as Error).message;
        } finally {
            if (locked) GUI.connect_lock = false;
            running.value = false;
            ddDumpBusy.value = false;
        }
    }

    async function selectPort() {
        await DeviceHandler.requestDevicePermission("serial");
        if (
            !DeviceHandler.currentSerialPorts.some(
                (device) => device.path === DeviceHandler.devicePicker.selectedDevice,
            )
        ) {
            message.value = "COM-порт не выбран. Нужен обычный режим работы, не DFU.";
            return;
        }
        needsPort.value = false;
        const action = pending.value;
        pending.value = null;
        if (action) await perform(action);
    }

    function chooseStreamDump() {
        if (busy.value || GUI.connect_lock || GUI.flashingInProgress) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt,.dump,.diff,.cli";
        input.addEventListener(
            "change",
            async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    streamSettings = streamSettingsFromDump(await file.text());
                    await perform("streamRestore");
                } catch (error) {
                    streamSettings = null;
                    opened.value = true;
                    message.value = (error as Error).message;
                    replies.value = "";
                }
            },
            { once: true },
        );
        input.click();
    }

    return {
        busy,
        opened,
        message,
        needsPort,
        accConfirmation,
        gyroConfirmation,
        baroConfirmation,
        replies,
        perform,
        selectPort,
        chooseStreamDump,
    };
}
