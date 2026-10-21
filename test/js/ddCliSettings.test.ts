import { expect, it } from "vitest";
import { settingAcknowledged, streamSettingsFromDump } from "../../src/composables/ddCliSettings";

it("accepts actual firmware set-to replies as well as equals replies", () => {
    expect(settingAcknowledged(["gyro_cal_on_startup set to OFF"], "gyro_cal_on_startup", "OFF")).toBe(true);
    expect(settingAcknowledged(["gyro_cal_on_startup = ON"], "gyro_cal_on_startup", "ON")).toBe(true);
    expect(settingAcknowledged(["gyro_cal_on_startup set to OFF"], "gyro_cal_on_startup", "ON")).toBe(false);
    expect(settingAcknowledged(["gyro_cal_on_startup set to OFF", "###ERROR"], "gyro_cal_on_startup", "OFF")).toBe(
        false,
    );
});
it("extracts only streaming settings, retaining final assignments", () => {
    const settings = streamSettingsFromDump(
        "\uFEFF# dump\nset unrelated = 10\nset msp_telemetry_stream_port = 20\nset msp_telemetry_stream_rate_hz = 1000\nset msp_telemetry_stream_mag = OFF\nset msp_telemetry_stream_port = 1\nsave",
    );
    expect(Object.fromEntries(settings)).toEqual({
        msp_telemetry_stream_port: "1",
        msp_telemetry_stream_rate_hz: "1000",
        msp_telemetry_stream_mag: "OFF",
    });
});
it("rejects files without streaming settings or the port", () => {
    expect(() => streamSettingsFromDump("set other = 1")).toThrow();
    expect(() => streamSettingsFromDump("set msp_telemetry_stream_mag = ON")).toThrow();
});
