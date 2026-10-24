import MSPCodes from "../js/msp/MSPCodes";
import { calibrationExchange } from "./useDdGyroCalibration";

interface BaroResult {
    pressurePa: number;
    altitudeCm: number;
    samples: number;
    savedValid: boolean;
    useSaved: boolean;
}

export function decodeBaroResult(data: DataView): BaroResult {
    if (data.byteLength !== 16) throw new Error("Некорректная длина ответа барометра.");
    const reasons = [
        "успех",
        "занят",
        "небезопасное состояние / ARM",
        "датчик не готов",
        "некорректные данные",
        "давление нестабильно",
        "тайм-аут",
        "нет калибровки",
        "несовместимый транспорт",
    ];
    const reason = data.getUint8(1);
    if (data.getUint8(0) !== 1 || reason !== 0)
        throw new Error(`Барометр: ${reasons[reason] ?? `неизвестная ошибка ${reason}`}.`);
    const pressurePa = data.getFloat32(4, true);
    const altitudeCm = data.getFloat32(8, true);
    if (
        data.getUint8(2) > 1 ||
        data.getUint8(3) > 1 ||
        !Number.isFinite(pressurePa) ||
        pressurePa < 20000 ||
        pressurePa > 130000 ||
        !Number.isFinite(altitudeCm)
    )
        throw new Error("Некорректные данные барометра.");
    return {
        pressurePa,
        altitudeCm,
        samples: data.getUint32(12, true),
        savedValid: data.getUint8(2) === 1,
        useSaved: data.getUint8(3) === 1,
    };
}

export async function calibrateAndSaveBaro(onReply: (stage: "calibrate" | "save", result: BaroResult) => void) {
    const result = await calibrationExchange(
        MSPCodes.MSP2_VT_BARO_CAL_START,
        MSPCodes.MSP2_VT_BARO_CAL_RESULT,
        decodeBaroResult,
        "барометр",
    );
    onReply("calibrate", result);
    const saved = await calibrationExchange(
        MSPCodes.MSP2_VT_BARO_GROUND_SAVE,
        MSPCodes.MSP2_VT_BARO_GROUND_SAVE,
        decodeBaroResult,
        "барометр",
    );
    if (!saved.savedValid) throw new Error("Полётник не подтвердил наличие сохранённого нуля барометра.");
    onReply("save", saved);
}
