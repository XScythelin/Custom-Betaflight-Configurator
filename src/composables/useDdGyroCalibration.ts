import MSP from "../js/msp";
import MSPCodes from "../js/msp/MSPCodes";
import { serial } from "../js/serial";

interface Frame {
    code: number;
    crcError: boolean;
    unsupported: boolean;
    dataView: DataView;
}

export function decodeGyroResult(data: DataView): number[][] {
    if (data.byteLength < 13 || (data.byteLength - 1) % 12 || data.byteLength > 97) {
        throw new Error("Некорректная длина ответа гироскопа.");
    }
    if (data.getUint8(0) !== 1) throw new Error("Полётник сообщил об ошибке операции гироскопа.");
    const records: number[][] = [];
    for (let offset = 1; offset < data.byteLength; offset += 12) {
        const axes = [0, 4, 8].map((axis) => data.getFloat32(offset + axis, true));
        if (axes.some((value) => !Number.isFinite(value) || Math.abs(value) > 32767))
            throw new Error("Некорректные поправки гироскопа.");
        records.push(axes);
    }
    return records;
}

function exchange(command: number, expected: number): Promise<number[][]> {
    return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => {
            clearTimeout(timer);
            const index = MSP.listeners.indexOf(listener);
            if (index !== -1) MSP.listeners.splice(index, 1);
        };
        const fail = (error: Error) => {
            cleanup();
            reject(error);
        };
        const listener = (frame: Frame) => {
            if (frame.code !== expected && frame.code !== command) return;
            if (frame.crcError || frame.unsupported) {
                fail(new Error("Повреждённый ответ или команда гироскопа не поддерживается прошивкой."));
                return;
            }
            if (frame.code !== expected) return;
            try {
                const result = decodeGyroResult(frame.dataView);
                cleanup();
                resolve(result);
            } catch (error) {
                fail(error as Error);
            }
        };
        MSP.listen(listener);
        timer = setTimeout(
            () => fail(new Error("Нет ответа гироскопа за 35 секунд. Результат неизвестен; команда не повторялась.")),
            35000,
        );
        if (!serial.connected) {
            fail(new Error("Полётник отключён."));
            return;
        }
        // START replies asynchronously with RESULT, not START. Never retry calibration or flash writes.
        try {
            const packet = MSP.encode_message_v2(command);
            serial.send(packet, (info: { bytesSent: number }) => {
                if (info.bytesSent !== packet.byteLength)
                    fail(new Error("Команда отправлена не полностью. Результат неизвестен."));
            });
        } catch (error) {
            fail(error as Error);
        }
    });
}

export async function calibrateAndSaveGyro(onReply: (stage: "calibrate" | "save", values: number[][]) => void) {
    const calibrated = await exchange(MSPCodes.MSP2_VT_GYRO_RECAL_START, MSPCodes.MSP2_VT_GYRO_RECAL_RESULT);
    onReply("calibrate", calibrated);
    const saved = await exchange(MSPCodes.MSP2_VT_GYRO_GROUND_SAVE, MSPCodes.MSP2_VT_GYRO_GROUND_SAVE);
    onReply("save", saved);
}
