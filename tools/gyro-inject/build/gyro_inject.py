"""Стендовое внесение ошибки gyro относительно новой успешной калибровки."""

import argparse
import math
import re
import struct
import time

from gyro_calibration_protocol import START, SET, RESULT, CURRENT, GROUND_SAVE, decode_result
from msp_telemetry_snapshot import MspReader, msp_v2_request, decode_split_snapshot

STATE = 0x3011
REBOOT = 68
FIXED_SCALES = {name: 2000.0 / 32768 for name in ('BMI270', 'BMI160', 'MPU6050', 'ICM20689')}
LEGACY_GYROS = ('AUTO', 'NONE', 'MPU6050', 'L3G4200D', 'MPU3050', 'L3GD20',
                'MPU6000', 'MPU6500', 'MPU9250', 'ICM20601', 'ICM20602',
                'ICM20608G', 'ICM20649', 'ICM20689', 'ICM42605', 'ICM42688P',
                'BMI160', 'BMI270', 'LSM6DSO', 'LSM6DSV16X', 'VIRTUAL')


def detect_parameters(client):
    api = client.request(1)
    if len(api) != 3 or api[1] != 1 or api[2] < 47:
        raise RuntimeError('Нужна поддерживаемая MSP API 1.47+ нашей прошивки')
    if api[2] >= 48:
        matches = re.findall(r'^gyro:\s*(.+)$', client.cli('sensor_hardware'), re.M)
        if len(matches) != 1:
            raise RuntimeError('Прошивка не сообщила однозначный список моделей гироскопов')
        names = tuple(name.strip() for name in matches[0].split(','))
    else:
        names = tuple(name for name in LEGACY_GYROS if name not in ('L3G4200D', 'MPU3050', 'VIRTUAL'))
        names += ('IIM42653', 'ICM45605', 'ICM45686', 'ICM40609D', 'IIM42652', 'VIRTUAL')
    detected = client.request(0x300D)
    if not detected or not 1 <= detected[0] <= 8 or len(detected) != detected[0] + 1:
        raise RuntimeError('Некорректный список гироскопов')
    if any(index >= len(names) for index in detected[1:]):
        raise RuntimeError('Неизвестный идентификатор гироскопа')
    active = [names[index] for index in detected[1:] if names[index] != 'NONE']
    if len(active) != 1 or active[0] not in FIXED_SCALES:
        raise RuntimeError(f'Неподдерживаемые или неоднозначные гироскопы: {active}. Коэффициент не угадывается.')
    if len(client.request(CURRENT)) != 12:
        raise RuntimeError('Прошивка должна возвращать смещения ровно одного гироскопа')
    startup = re.findall(r'^gyro_cal_on_startup\s*=\s*(ON|OFF)\s*$',
                         client.cli('get gyro_cal_on_startup'), re.M)
    if startup != ['OFF']:
        raise RuntimeError('Сначала отключите автокалибровку гироскопа кнопкой конфигуратора')
    client.disarmed()
    return active[0], FIXED_SCALES[active[0]]


def target_offsets(baseline, errors, scale):
    """Offsets are subtracted before alignment: positive raw error needs a lower zero."""
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('Scale должен быть положительным конечным числом')
    if len(baseline) != 12 or len(errors) != 3:
        raise ValueError('Поддерживается ровно один гироскоп и три оси')
    values = struct.unpack('<3f', baseline)
    if any(not math.isfinite(v) for v in (*values, *errors)):
        raise ValueError('NaN/Inf запрещены')
    if any(abs(v) > 10 for v in errors):
        raise ValueError('Стендовый предел ошибки: ±10 °/с')
    result = tuple(zero - error / scale for zero, error in zip(values, errors))
    if any(abs(v) > 32767 for v in result):
        raise ValueError('Поправки вне допустимого диапазона firmware')
    return struct.pack('<3f', *result)


class Client:
    def __init__(self, port):
        self.port = port
        self.reader = MspReader(port)

    def cli(self, command):
        # STX/ETX read-only CLI transport does not enter interactive '#' CLI mode.
        wire = b'\x02' + command.encode('ascii') + b'\n\x03'
        if self.port.write(wire) != len(wire):
            raise OSError('Неполная отправка запроса параметров')
        deadline = time.monotonic() + 5
        output = bytearray()
        started = False
        while time.monotonic() < deadline:
            byte = self.port.read(1)
            if byte == b'\x02':
                started = True
                output.clear()
            elif started and byte == b'\x03':
                text = output.decode('utf-8', errors='strict').replace('\r', '')
                if 'ERROR' in text:
                    raise RuntimeError('Прошивка отклонила чтение параметров')
                return text
            elif started:
                output.extend(byte)
                if len(output) > 65536:
                    raise RuntimeError('Слишком большой ответ параметров')
        raise RuntimeError('Нет полного ответа параметров; калибровка не запущена')

    def request(self, command, payload=b'', response=None, timeout=5):
        wire = msp_v2_request(command, payload)
        if self.port.write(wire) != len(wire):
            raise OSError('Неполная отправка; итог неизвестен. Автоповтора нет.')
        answer = self.reader.read_response(command if response is None else response, timeout)
        if answer is None:
            raise OSError('Нет ответа; итог неизвестен. Автоповтора нет.')
        return answer

    def disarmed(self):
        state = decode_split_snapshot(self.request(STATE), STATE)
        if state['armed']:
            raise RuntimeError('ARM включён: операция запрещена')


def successful(payload):
    result = decode_result(payload)
    if not result['success'] or len(result['records']) != 1:
        raise RuntimeError('Нужен успешный ответ ровно одного гироскопа')
    return payload[1:]


def inject(client, errors):
    name, scale = detect_parameters(client)
    target_offsets(bytes(12), errors, scale)
    print(f'Автоопределение: {name}; коэффициент {scale} °/с на raw count.')
    client.disarmed()
    print('Перекалибровка: не двигайте коптер. Жду успешный RESULT...')
    baseline = successful(client.request(START, response=RESULT, timeout=40))
    target = target_offsets(baseline, errors, scale)
    print('Калибровка успешна. Устанавливаю смещения относительно нового нуля...')
    client.disarmed()
    applied = successful(client.request(SET, target, response=RESULT, timeout=40))
    if applied != target or client.request(CURRENT) != target:
        raise RuntimeError('Рабочие смещения не совпали с заданными; запись отменена')
    print('SET подтверждён, смещения проверены. Сохраняю...')
    client.disarmed()
    if successful(client.request(GROUND_SAVE, timeout=15)) != target:
        raise RuntimeError('Сохранённые смещения не совпали; состояние требует проверки')
    print('MSP SAVE подтверждён. Отправляю MSP REBOOT...')
    if client.request(REBOOT) != b'\0':
        raise RuntimeError('Неожиданный ответ MSP REBOOT; проверьте перезапуск FC')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port')
    parser.add_argument('--baud', type=int, default=250000)
    args = parser.parse_args()
    import serial
    from com_tools import choose_port
    device = args.port or choose_port()
    if device is None:
        return
    print('ТОЛЬКО СТЕНД, БЕЗ ПРОПЕЛЛЕРОВ. Снять ARM, газ в минимум.')
    print('Сначала новая калибровка, затем заданная ошибка. Старые ошибки НЕ накапливаются.')
    print('Требуется gyro_cal_on_startup = OFF, как в нашем дампе; настройки CLI не меняются.')
    print('X/Y/Z — сырые оси датчика, НЕ гарантированно ROLL/PITCH/YAW корпуса.')
    print('Ошибка задаётся в °/с, не в градусах угла; плюс = положительная скорость на месте.')
    print('Датчик и коэффициент проверяются автоматически перед калибровкой.')
    print('Все три знака задают ошибку в сырых осях датчика; прежняя инверсия Y удалена.')
    errors = tuple(float(input(f'{axis}, ошибка [°/с], от -10 до +10: ').replace(',', '.'))
                   for axis in 'XYZ')
    target_offsets(bytes(12), errors, 1)
    print(f'Будет внесено X/Y/Z={errors} °/с; сохранение ВСЕЙ конфигурации и reboot.')
    if input('Продолжить? Введите ДА: ').strip().upper() != 'ДА':
        return
    try:
        with serial.Serial(device, args.baud, timeout=.05, write_timeout=2) as port:
            inject(Client(port), errors)
        print('MSP SAVE и MSP REBOOT подтверждены. Автопереподключения нет.')
        print('Перед дальнейшими действиями убедитесь, что reboot завершился; иначе перезапустите FC вручную.')
    except (OSError, RuntimeError, ValueError) as exc:
        print(f'ОСТАНОВЛЕНО: {exc}')
        print('Состояние могло измениться. Не армить. Нет автоповтора/отката.')
        print('Если входили в CLI, закрытие порта НЕ снимает CLI arming-disable: нужен reboot.')
        raise SystemExit(1)
    print('НЕ ЛЕТАТЬ с внесённой ошибкой. Для нового чистого нуля запустите с X=0, Y=0, Z=0.')
    print('Для восстановления: gyro_calibrate → SUCCESS → save с перезагрузкой.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('Остановлено. Если операция началась — не армить, проверить состояние FC.')
    except ValueError as exc:
        raise SystemExit(f'Неверный ввод: {exc}')
    except ImportError:
        raise SystemExit('Установите pyserial: python -m pip install pyserial')
