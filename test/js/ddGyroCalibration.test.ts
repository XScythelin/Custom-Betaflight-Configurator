import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ listeners: [] as Array<(frame: unknown) => void>, send: vi.fn() }));
vi.mock("../../src/js/msp", () => ({
    default: {
        listeners: mock.listeners,
        listen: (listener: (frame: unknown) => void) => mock.listeners.push(listener),
        encode_message_v2: (code: number) => code,
    },
}));
vi.mock("../../src/js/serial", () => ({ serial: { connected: true, send: mock.send } }));
import { calibrateAndSaveGyro } from "../../src/composables/useDdGyroCalibration";
import { calibrateAndSaveBaro, decodeBaroResult } from "../../src/composables/useDdBaroCalibration";

function reply(code: number, success = 1) {
    const dataView = new DataView(new ArrayBuffer(13));
    dataView.setUint8(0, success);
    for (const listener of [...mock.listeners]) listener({ code, dataView, crcError: false, unsupported: false });
}
beforeEach(() => {
    vi.useFakeTimers();
    mock.listeners.length = 0;
    mock.send.mockReset();
});
afterEach(() => vi.useRealTimers());
function baroReply(code: number, reason = 0, saved = true) {
    const dataView = new DataView(new ArrayBuffer(16));
    dataView.setUint8(0, reason === 0 ? 1 : 0);
    dataView.setUint8(1, reason);
    dataView.setUint8(2, saved ? 1 : 0);
    dataView.setFloat32(4, 101325, true);
    dataView.setUint32(12, 100, true);
    for (const listener of [...mock.listeners]) listener({ code, dataView, crcError: false, unsupported: false });
}
it("waits for barometer calibration, saves and checks saved validity", async () => {
    const callback = vi.fn();
    const operation = calibrateAndSaveBaro(callback);
    expect(mock.send.mock.calls.map((call) => call[0])).toEqual([0x3018]);
    baroReply(0x3019);
    await Promise.resolve();
    expect(mock.send.mock.calls.map((call) => call[0])).toEqual([0x3018, 0x301a]);
    baroReply(0x301a);
    await operation;
    expect(callback.mock.calls.map((call) => call[0])).toEqual(["calibrate", "save"]);
});
it("never saves a failed barometer calibration", async () => {
    const operation = calibrateAndSaveBaro(vi.fn());
    const assertion = expect(operation).rejects.toThrow("нестабильно");
    baroReply(0x3019, 5);
    await assertion;
    expect(mock.send).toHaveBeenCalledTimes(1);
});
it("rejects save without valid stored barometer zero", async () => {
    const callback = vi.fn();
    const operation = calibrateAndSaveBaro(callback);
    const assertion = expect(operation).rejects.toThrow("сохранённого");
    baroReply(0x3019);
    await Promise.resolve();
    baroReply(0x301a, 0, false);
    await assertion;
    expect(callback).toHaveBeenCalledTimes(1);
});
it("rejects malformed barometer responses", () => {
    expect(() => decodeBaroResult(new DataView(new ArrayBuffer(15)))).toThrow("длина");
});
it("waits for RESULT before saving, and separately acknowledges SAVE", async () => {
    const onReply = vi.fn();
    const operation = calibrateAndSaveGyro(onReply);
    expect(mock.send.mock.calls.map((call) => call[0])).toEqual([0x3013]);
    reply(0x3015);
    await Promise.resolve();
    expect(mock.send.mock.calls.map((call) => call[0])).toEqual([0x3013, 0x3017]);
    expect(onReply).toHaveBeenCalledTimes(1);
    reply(0x3017);
    await operation;
    expect(onReply.mock.calls.map((call) => call[0])).toEqual(["calibrate", "save"]);
    expect(mock.listeners).toHaveLength(0);
});
it("never saves after failed calibration", async () => {
    const operation = calibrateAndSaveGyro(vi.fn());
    const assertion = expect(operation).rejects.toThrow("ошибке");
    reply(0x3015, 0);
    await assertion;
    expect(mock.send).toHaveBeenCalledTimes(1);
});
it("does not retry START or save when the calibration reply is missing", async () => {
    const operation = calibrateAndSaveGyro(vi.fn());
    const assertion = expect(operation).rejects.toThrow("35 секунд");
    await vi.advanceTimersByTimeAsync(35001);
    await assertion;
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.listeners).toHaveLength(0);
});
it("does not report save success when the save reply is missing", async () => {
    const callback = vi.fn();
    const operation = calibrateAndSaveGyro(callback);
    const assertion = expect(operation).rejects.toThrow("35 секунд");
    reply(0x3015);
    await vi.advanceTimersByTimeAsync(35001);
    await assertion;
    expect(callback.mock.calls.map((call) => call[0])).toEqual(["calibrate"]);
    expect(mock.send).toHaveBeenCalledTimes(2);
});
