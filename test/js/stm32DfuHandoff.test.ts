import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
    wait: vi.fn(),
    permission: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    prompt: vi.fn(),
    gui: { connect_lock: true },
}));
vi.mock("../../src/js/msp/MSPConnector", () => ({ default: class {} }));
vi.mock("../../src/js/gui", () => ({
    default: mock.gui,
    TABS: { firmware_flasher: { resetFlashingState: mock.reset, requestDfuPermission: mock.prompt } },
}));
vi.mock("../../src/js/localization", () => ({ i18n: { getMessage: (key: string) => key } }));
vi.mock("../../src/js/msp", () => ({ default: {} }));
vi.mock("../../src/js/fc", () => ({ default: {} }));
vi.mock("../../src/js/gui_log", () => ({ gui_log: vi.fn() }));
vi.mock("../../src/js/port_usage", () => ({ default: {} }));
vi.mock("../../src/js/serial", () => ({ serial: { removeEventListener: vi.fn() } }));
vi.mock("../../src/js/connection_state", () => ({ getConnectionState: () => ({ endFlashing: vi.fn() }) }));
vi.mock("../../src/js/protocols/usbdfu", () => ({ DFU_AUTH_REQUIRED: "AUTH" }));
vi.mock("../../src/js/device_handler", () => ({
    default: {
        dfuProtocol: { waitForDfu: mock.wait, requestPermission: mock.permission, dispatchEvent: mock.dispatch },
    },
}));
vi.mock("../../src/js/utils/notifications", () => ({ default: {} }));
vi.mock("../../src/js/ConfigStorage", () => ({ get: vi.fn() }));

import STM32 from "../../src/js/protocols/webstm32";

beforeEach(() => {
    vi.resetAllMocks();
    STM32.rebootMode = 1;
    mock.gui.connect_lock = true;
});

it("hands an authorized bootloader to the flasher without a new USB connect event", async () => {
    const device = { path: "usb_stm32" };
    mock.wait.mockResolvedValue(device);
    await STM32.handleDisconnect(true);
    expect(mock.dispatch).toHaveBeenCalledOnce();
    expect(mock.dispatch.mock.calls[0][0].detail).toBe(device);
    expect(mock.permission).not.toHaveBeenCalled();
});

it("hands a newly authorized bootloader to the flasher", async () => {
    const device = { path: "usb_new" };
    mock.wait.mockRejectedValue({ code: "AUTH" });
    mock.permission.mockResolvedValue(device);
    await STM32.handleDisconnect(true);
    expect(mock.dispatch.mock.calls[0][0].detail).toBe(device);
});

it("does not restart a handoff already consumed by the USB event", async () => {
    mock.wait.mockImplementation(async () => {
        STM32.rebootMode = 0;
        return { path: "usb_stm32" };
    });
    await STM32.handleDisconnect(true);
    expect(mock.dispatch).not.toHaveBeenCalled();
});

it("does not ask for permission after an earlier USB event has already resumed flashing", async () => {
    mock.wait.mockImplementation(async () => {
        STM32.rebootMode = 0;
        throw { code: "AUTH" };
    });
    await STM32.handleDisconnect(true);
    expect(mock.permission).not.toHaveBeenCalled();
    expect(mock.reset).not.toHaveBeenCalled();
});

it("shows the manual permission prompt on cancellation instead of waiting silently", async () => {
    mock.wait.mockRejectedValue({ code: "AUTH" });
    mock.permission.mockResolvedValue(null);
    await STM32.handleDisconnect(true);
    expect(mock.prompt).toHaveBeenCalledOnce();
});
