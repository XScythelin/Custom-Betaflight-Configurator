import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
    gui: { connect_lock: false, flashingInProgress: false, tab_switch_in_progress: false, active_tab: "landing" },
    config: { connectionValid: true, cliActive: false },
    fc: {
        CONFIG: { mode: 0, activeSensors: 1, configurationProblems: 0 },
        CONFIGURATION_PROBLEM_FLAGS: { ACC_NEEDS_CALIBRATION: 0 },
    },
    devices: {
        currentSerialPorts: [],
        devicePicker: { selectedDevice: "", autoConnect: true },
        requestDevicePermission: vi.fn(),
    },
    request: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    switchTab: vi.fn(() => true),
}));
vi.mock("../../src/js/gui", () => ({ default: mock.gui }));
vi.mock("../../src/js/fc", () => ({ default: mock.fc }));
vi.mock("../../src/js/data_storage", () => ({ default: mock.config }));
vi.mock("../../src/js/device_handler", () => ({ default: mock.devices }));
vi.mock("../../src/js/serial_backend", () => ({ connectDisconnect: mock.connect, disconnect: mock.disconnect }));
vi.mock("../../src/composables/useMspCliSession", () => ({ send: mock.send, isMspCliSupported: () => true }));
vi.mock("../../src/composables/useDdGyroCalibration", () => ({ calibrateAndSaveGyro: vi.fn() }));
vi.mock("../../src/js/tab_switch", () => ({ switchTab: mock.switchTab }));
vi.mock("../../src/js/msp", () => ({ default: { promise: mock.request } }));

import { useDdQuickActions } from "../../src/composables/useDdQuickActions";
import { ddDumpBusy } from "../../src/composables/ddOperationState";
import MSPCodes from "../../src/js/msp/MSPCodes";

describe("home quick actions safety", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mock.request.mockResolvedValue({});
        mock.config.connectionValid = true;
        mock.config.cliActive = false;
        mock.gui.connect_lock = false;
        mock.devices.devicePicker.autoConnect = true;
        mock.disconnect.mockImplementation(() => {
            mock.config.connectionValid = false;
        });
        mock.fc.CONFIG.mode = 0;
        mock.fc.CONFIG.activeSensors = 1;
        mock.fc.CONFIG.configurationProblems = 0;
        ddDumpBusy.value = false;
        const actions = useDdQuickActions();
        actions.opened.value = false;
        actions.needsPort.value = false;
    });
    afterEach(() => vi.useRealTimers());

    it("never calibrates an armed controller", async () => {
        mock.fc.CONFIG.mode = 1;
        const actions = useDdQuickActions();
        await actions.perform("acc");
        expect(mock.request.mock.calls.map((call) => call[0])).toEqual([MSPCodes.MSP_STATUS]);
        expect(actions.message.value).toContain("ARM");
        expect(mock.gui.connect_lock).toBe(false);
    });
    it("never calibrates without an accelerometer", async () => {
        mock.fc.CONFIG.activeSensors = 0;
        await useDdQuickActions().perform("acc");
        expect(mock.request).toHaveBeenCalledTimes(1);
    });
    it("does not claim success when calibration is rejected", async () => {
        mock.request.mockImplementation((code) =>
            code === MSPCodes.MSP_ACC_CALIBRATION ? Promise.reject(new Error("unsupported")) : Promise.resolve({}),
        );
        const actions = useDdQuickActions();
        await actions.perform("acc");
        expect(actions.message.value).toBe("unsupported");
        expect(ddDumpBusy.value).toBe(false);
        expect(mock.gui.connect_lock).toBe(false);
    });
    it("requires explicit port choice instead of connecting to nothing", async () => {
        mock.config.connectionValid = false;
        const actions = useDdQuickActions();
        await actions.perform("cli");
        expect(actions.needsPort.value).toBe(true);
        expect(mock.connect).not.toHaveBeenCalled();
        expect(mock.switchTab).not.toHaveBeenCalled();
    });
    it("opens CLI directly when connected", async () => {
        await useDdQuickActions().perform("cli");
        expect(mock.switchTab).toHaveBeenCalledWith("cli", { mode: "cli" });
        expect(mock.request).not.toHaveBeenCalled();
    });
    it("reports failure if firmware still requires calibration", async () => {
        mock.fc.CONFIG.configurationProblems = 1;
        const actions = useDdQuickActions();
        const operation = actions.perform("acc");
        await vi.advanceTimersByTimeAsync(2600);
        await operation;
        expect(actions.message.value).toContain("всё ещё");
    });
    it("disconnects after successful accelerometer calibration and disables auto connect", async () => {
        const operation = useDdQuickActions().perform("acc");
        await vi.advanceTimersByTimeAsync(2600);
        await operation;
        expect(mock.disconnect).toHaveBeenCalledOnce();
        expect(mock.devices.devicePicker.autoConnect).toBe(false);
    });
    it.each(["gyroAutoOn", "gyroAutoOff"])(
        "does not save or disconnect when %s setting is rejected",
        async (action) => {
            mock.send.mockResolvedValue(["###ERROR: invalid name"]);
            await useDdQuickActions().perform(action);
            expect(mock.send).toHaveBeenCalledTimes(1);
            expect(mock.disconnect).not.toHaveBeenCalled();
        },
    );
    it.each([
        ["gyroAutoOn", "ON"],
        ["gyroAutoOff", "OFF"],
    ])("saves acknowledged %s setting and disconnects", async (action, value) => {
        mock.send.mockResolvedValueOnce([`gyro_cal_on_startup set to ${value}`]).mockResolvedValueOnce(["# saving"]);
        await useDdQuickActions().perform(action);
        expect(mock.send.mock.calls.map((call) => call[0])).toEqual([
            `set gyro_cal_on_startup = ${value}`,
            "save noreboot",
        ]);
        expect(mock.disconnect).toHaveBeenCalledOnce();
    });
    it("saves USB streaming port and disconnects", async () => {
        mock.send.mockResolvedValueOnce(["msp_telemetry_stream_port set to 20"]).mockResolvedValueOnce(["# saving"]);
        await useDdQuickActions().perform("streamUsb");
        expect(mock.send.mock.calls.map((call) => call[0])).toEqual([
            "set msp_telemetry_stream_port = 20",
            "save noreboot",
        ]);
        expect(mock.disconnect).toHaveBeenCalledOnce();
    });
    it("disconnects after acknowledged gyro calibration and save", async () => {
        await useDdQuickActions().perform("gyroCalibrate");
        expect(mock.disconnect).toHaveBeenCalledOnce();
        expect(mock.devices.devicePicker.autoConnect).toBe(false);
    });
});
