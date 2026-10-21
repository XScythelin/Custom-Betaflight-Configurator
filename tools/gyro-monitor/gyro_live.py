"""Монитор MSP IMU: C — калибровка RAM, S — сохранить текущий ноль во flash."""

import argparse
from collections import deque
import math
import os
import re
import shutil
import sys
import time

from msp_telemetry_snapshot import MspReader, decode_split_snapshot, msp_v2_request
from gyro_calibration_protocol import START, RESULT, GROUND_SAVE, decode_result


class CalibrationControl:
    """One outstanding operation; missing replies never trigger a blind retry."""

    def __init__(self):
        self.pending = None
        self.status = 'C: калибровка RAM | S: сохранить текущий ноль во flash (только disarmed)'
        self.notice = None
        self.notice_until = 0
        self.values = ''

    def request(self, port, command, now):
        if self.pending is not None:
            self.status = 'Операция уже запрошена; ожидаем ответ. C/S заблокированы.'
            return
        request = msp_v2_request(command)
        if port.write(request) != len(request):
            raise OSError('Неполная отправка запроса; итог неизвестен')
        self.pending = (RESULT if command == START else GROUND_SAVE, now)
        self.values = ''
        self.notice = 'CAL' if command == START else 'SAVE'
        self.notice_until = float('inf')
        self.status = ('Калибровка RAM; не двигайте плату. Ожидание RESULT...'
                       if command == START else 'Сохранение во flash всей конфигурации. Ожидание ответа SAVE...')

    def receive(self, frame, now):
        if self.pending is None or frame.command != self.pending[0]:
            return False
        label = 'SAVE' if frame.command == GROUND_SAVE else 'CAL RAM'
        if frame.error:
            self.pending = None
            self.notice = 'FAILED'
            self.notice_until = now + 5
            self.status = f'{label}: MSP отказ / команда не поддерживается firmware'
            return True
        result = decode_result(frame.payload)
        elapsed = now - self.pending[1]
        self.pending = None
        self.notice = 'SUCCESS' if result['success'] else 'FAILED'
        self.notice_until = now + (2.5 if result['success'] else 5)
        zeros = ' | '.join(f'G{i}: ' + ', '.join(f'{v:+.6f}' for v in triple)
                           for i, triple in enumerate(result['records']))
        values = 'saved raw offsets' if frame.command == GROUND_SAVE else 'working raw offsets'
        self.status = f'{label}: {self.notice} ({elapsed:.2f} s)'
        self.values = f'{values}: {zeros}'
        return True

    def tick(self, now):
        if self.pending is not None and now - self.pending[1] > 35:
            self.status = 'Нет ответа >35 s: итог неизвестен. C/S заблокированы до перезапуска монитора'
            if self.notice in ('CAL', 'SAVE'):
                self.notice = '?'
                self.notice_until = now + 5


def trace(values, width, scale, height=7):
    """Graph resized to the terminal, with an explicit zero-centred scale."""
    middle = (height - 1) / 2
    zero_row = round(middle)
    grid = [[' ' for _ in range(width)] for _ in range(height)]
    grid[zero_row] = ['-' for _ in range(width)]
    for col, value in enumerate(values[-width:]):
        row = round(middle - max(-1, min(1, value / scale)) * middle)
        grid[row][col + max(0, width - len(values))] = '*'
    return [''.join(row) for row in grid]


def graph_size(columns, rows, large_extrema=False, banner_scale=1):
    # Five header lines, six axis headings/statistics, two footer lines and
    # one spare terminal row to avoid scrolling at the bottom edge.
    banner_height = 1 + 5 * max(1, banner_scale // 2) if large_extrema else 1
    height = max(0, (rows - 14 - 3 * banner_height) // 3)
    if height % 2 == 0 and height:
        height -= 1
    return max(1, columns - 14), height


def extrema_banner(low, high, scale=1, title='MIN слева / MAX справа видимого графика [deg/s]', angle=None, axis=None):
    glyphs = {
        '0': ('###', '# #', '# #', '# #', '###'),
        '1': (' # ', '## ', ' # ', ' # ', '###'),
        '2': ('###', '  #', '###', '#  ', '###'),
        '3': ('###', '  #', '###', '  #', '###'),
        '4': ('# #', '# #', '###', '  #', '  #'),
        '5': ('###', '#  ', '###', '  #', '###'),
        '6': ('###', '#  ', '###', '# #', '###'),
        '7': ('###', '  #', '  #', '  #', '  #'),
        '8': ('###', '# #', '###', '# #', '###'),
        '9': ('###', '# #', '###', '  #', '###'),
        '+': ('   ', ' # ', '###', ' # ', '   '),
        '-': ('   ', '   ', '###', '   ', '   '),
        '.': (' ', ' ', ' ', ' ', '#'),
        ' ': (' ', ' ', ' ', ' ', ' '),
        'R': ('## ', '# #', '## ', '# #', '# #'),
        'O': ('###', '# #', '# #', '# #', '###'),
        'L': ('#  ', '#  ', '#  ', '#  ', '###'),
        'P': ('## ', '# #', '## ', '#  ', '#  '),
        'I': ('###', ' # ', ' # ', ' # ', '###'),
        'T': ('###', ' # ', ' # ', ' # ', ' # '),
        'C': ('###', '#  ', '#  ', '#  ', '###'),
        'H': ('# #', '# #', '###', '# #', '# #'),
        'Y': ('# #', '# #', ' # ', ' # ', ' # '),
        'A': (' # ', '# #', '###', '# #', '# #'),
        'W': ('# #', '# #', '# #', '###', '# #'),
        '?': ('###', '  #', ' ##', '   ', ' # '),
        'M': ('# #', '###', '###', '# #', '# #'),
        'N': ('# #', '###', '###', '###', '# #'),
        'X': ('# #', '# #', ' # ', '# #', '# #'),
        'E': ('###', '#  ', '## ', '#  ', '###'),
        'D': ('## ', '# #', '# #', '# #', '## '),
        'S': ('###', '#  ', '###', '  #', '###'),
        'U': ('# #', '# #', '# #', '# #', '###'),
        'F': ('###', '#  ', '## ', '#  ', '#  '),
        'V': ('# #', '# #', '# #', '# #', ' # '),
    }
    def text(value):
        return [' '.join(glyphs[c][row] for c in value) for row in range(5)]
    fields = []
    if axis is not None:
        fields.append(text(axis))
    fields.extend([text(f'MIN {low:+.3f}' if axis else f'{low:+.3f}'),
                   text(f'MAX {high:+.3f}' if axis else f'{high:+.3f}')])
    if axis is not None:
        fields.append(text('ATT ' + ('?' if angle is None else f'{angle:+.1f}')))
    result = [title]
    for row in range(5):
        line = ''.join(c * scale for c in '   |   '.join(field[row] for field in fields))
        result.extend([line] * max(1, scale // 2))
    return result


def large_message(message, scale):
    # Reuse the same bitmap font without introducing another dependency.
    marker = extrema_banner(0, 0, scale, '', axis=message)
    # Only retain the first field (the message) from each bitmap row.
    separator = ''.join(c * scale for c in '   |   ')
    return [line.split(separator, 1)[0] for line in marker[1:]]


def display_layout(columns, rows, extrema):
    """Choose a font size that leaves room for all three complete graphs."""
    longest = max((len(line) for pair in extrema for line in extrema_banner(*pair, axis='PITCH', angle=-180.0)), default=80)
    size = min(max(1, columns // 85), max(1, rows // 50))
    while size:
        width, height = graph_size(columns, rows, True, size)
        if longest * size < columns and height >= 3:
            return width, height, size
        size -= 1
    width, height = graph_size(columns, rows)
    return width, height, 0


def fit_line(line, width):
    """Keep ANSI colours without allowing long labels to wrap the display."""
    parts = re.split(r'(\033\[[0-9;]*m)', line)
    output = []
    remaining = max(0, width)
    for part in parts:
        if part.startswith('\033['):
            output.append(part)
        else:
            output.append(part[:remaining])
            remaining = max(0, remaining - len(part))
    return ''.join(output) + '\033[0m'


def key():
    if os.name == 'nt':
        import msvcrt
        return msvcrt.getwch().lower() if msvcrt.kbhit() else ''
    return ''


def attitude_degrees(values, axis):
    # MSP split STATE uses decidegrees for roll/pitch, degrees for yaw.
    return values[axis] if axis == 2 else values[axis] / 10


class AutoScale:
    def __init__(self, minimum):
        self.value = minimum
        self.hold_until = 0
        self.previous_at = None

    def update(self, peak, minimum, now):
        target = max(minimum, peak * 1.1)
        dt = 0 if self.previous_at is None else max(0, now - self.previous_at)
        self.previous_at = now
        if target > self.value:
            self.value = target
            self.hold_until = now + .5
        elif now >= self.hold_until:
            self.value = target + (self.value - target) * math.exp(-dt / .25)
            if self.value - target < target * .01:
                self.value = target
        return self.value


def run(args):
    try:
        import serial
    except ImportError:
        raise SystemExit('Установите зависимость: python -m pip install pyserial')
    if not sys.stdout.isatty():
        raise SystemExit('Запустите в интерактивном терминале, без перенаправления вывода.')
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.GetStdHandle(-11)
        mode = ctypes.c_ulong()
        if kernel.GetConsoleMode(handle, ctypes.byref(mode)):
            kernel.SetConsoleMode(handle, mode.value | 4)
    samples = deque()
    history = [deque(maxlen=8192) for _ in range(3)]
    arrivals = deque()
    state_arrivals = deque()
    latest = None
    attitude = None
    invalid = 0
    calibration = CalibrationControl()
    scale = args.scale
    auto = not args.no_auto_scale
    scales = [AutoScale(scale) for _ in range(3)]
    last_draw = 0
    last_size = None
    colours = ['\033[91m', '\033[92m', '\033[96m']
    with serial.Serial(args.port, args.baud, timeout=0, write_timeout=.5) as port:
        reader = MspReader(port)
        # Stay in the main screen buffer: alternate-screen wheel events may
        # be intercepted by terminal hosts instead of adjusting font zoom.
        sys.stdout.write('\033[?25l\033[2J')
        try:
            while True:
                now = time.monotonic()
                k = key()
                changed = bool(k)
                if k == 'q':
                    break
                if k in ('+', '='):
                    scale = max(.0001, scale / 2)
                elif k == '-':
                    scale = min(10000, scale * 2)
                elif k == 'a':
                    auto = not auto
                elif k in ('c', 's'):
                    calibration.request(port, START if k == 'c' else GROUND_SAVE, now)
                elif k == 'r':
                    samples.clear()
                    for h in history:
                        h.clear()
                reader.buffer.extend(port.read(min(port.in_waiting, 65536)))
                # Bound each batch so rendering and keyboard remain responsive.
                for _ in range(2000):
                    frame = reader.pop_frame()
                    if frame is None:
                        break
                    if frame.command in (RESULT, GROUND_SAVE):
                        changed = True
                        try:
                            calibration.receive(frame, now)
                        except ValueError as exc:
                            invalid += 1
                            calibration.status = f'Некорректный ответ: {exc}; итог неизвестен'
                            continue
                        continue
                    if frame.command not in (0x3010, 0x3011):
                        continue
                    if frame.error:
                        invalid += 1
                        continue
                    try:
                        data = decode_split_snapshot(frame.payload, frame.command)
                    except ValueError:
                        invalid += 1
                        continue
                    if frame.command == 0x3011:
                        attitude = (now, data['attitude'], data['attitude_age_us'])
                        state_arrivals.append(now)
                        changed = True
                        continue
                    gyro = data['gyro']
                    if not all(math.isfinite(v) for v in gyro):
                        invalid += 1
                        continue
                    latest = (now, gyro, data['gyro_age_us'])
                    samples.append((now, gyro))
                    arrivals.append(now)
                    for axis in range(3):
                        history[axis].append(gyro[axis])
                    changed = True
                while samples and samples[0][0] < now - 5:
                    samples.popleft()
                while arrivals and arrivals[0] < now - 2:
                    arrivals.popleft()
                while state_arrivals and state_arrivals[0] < now - 2:
                    state_arrivals.popleft()
                calibration.tick(now)
                # No frame cap: draw on data/key events. Idle refresh only
                # updates stale-data warnings without spinning on the terminal.
                if not changed and now - last_draw < .1:
                    time.sleep(.001)
                    continue
                last_draw = now
                cols, rows = shutil.get_terminal_size((100, 36))
                visible_width = max(1, cols - 14)
                extrema = [(min(list(h)[-visible_width:], default=0),
                            max(list(h)[-visible_width:], default=0)) for h in history]
                width, graph_height, banner_scale = display_layout(cols, rows, extrema)
                large_extrema = banner_scale > 0
                notice = large_extrema and calibration.notice is not None and now < calibration.notice_until
                if notice:
                    notice_rows = 5 * max(1, banner_scale // 2)
                    graph_height = max(0, graph_height - (notice_rows + 2) // 3)
                    if graph_height % 2 == 0 and graph_height:
                        graph_height -= 1
                stale = latest is None or now - latest[0] > .5
                hz = (len(arrivals) - 1) / (arrivals[-1] - arrivals[0]) if len(arrivals) > 1 and arrivals[-1] > arrivals[0] else 0
                state_hz = (len(state_arrivals) - 1) / (state_arrivals[-1] - state_arrivals[0]) if len(state_arrivals) > 1 and state_arrivals[-1] > state_arrivals[0] else 0
                lines = [f'GYRO LIVE | {args.port} | IMU {hz:.1f} Hz | STATE/attitude {state_hz:.1f} Hz | без лимита FPS',
                         f'Y: {"AUTO" if auto else "MANUAL"} | минимум/ручной +/-{scale:g} deg/s | CRC: {reader.invalid_frames} | invalid: {invalid}',
                         '+/- чувствительность | A авто-Y | C калибровка | S сохранить | R сброс | Q выход',
                         '\033[93mНЕТ СВЕЖИХ ДАННЫХ — проверьте stream port и закройте Configurator\033[0m' if stale else 'Данные свежие. Ноль не вычитается; дополнительного сглаживания нет.',
                         '\033[93m' + calibration.status + '\033[0m', calibration.values]
                if large_extrema:
                    lines = ['\033[93m' + calibration.status + '\033[0m', calibration.values,
                             'C: калибровка RAM | S: сохранить во flash | Q: выход']
                    if notice:
                        lines.extend('\033[93m\033[1m' + line + '\033[0m'
                                     for line in large_message(calibration.notice, banner_scale))
                if latest is not None:
                    for axis, name in enumerate(('X / ROLL', 'Y / PITCH', 'Z / YAW')):
                        value = latest[1][axis]
                        values = [g[axis] for _, g in samples]
                        mean = sum(values) / len(values) if values else 0
                        std = math.sqrt(sum((v - mean)**2 for v in values) / len(values)) if values else 0
                        peak = max(map(abs, values), default=0)
                        low, high = extrema[axis]
                        colour = colours[axis]
                        visible = list(history[axis])[-width:]
                        axis_scale = scales[axis].update(max(map(abs, visible), default=0), scale, now) if auto else scale
                        angle = 'ожидание STATE' if attitude is None else f'{attitude_degrees(attitude[1], axis):+8.1f} deg'
                        if attitude is not None and now - attitude[0] > .5:
                            angle += ' УСТАРЕЛО'
                        if not large_extrema:
                            lines.append(f'{colour}{name:9} {value:+11.6f} deg/s\033[0m | \033[95mangle {angle}\033[0m')
                            lines.append(f'{colour}          mean {mean:+.6f}  std {std:.6f}  peak {peak:.6f}  Y +/-{axis_scale:.4g}\033[0m')
                        if large_extrema:
                            title = 'ОСЬ | MIN [deg/s] | MAX [deg/s] | ATTITUDE [deg]'
                            angle_value = None if attitude is None else attitude_degrees(attitude[1], axis)
                            lines.extend(f'{colour}\033[1m{line}\033[0m' for line in extrema_banner(low, high, banner_scale, title, angle_value, name.split(' / ')[1])[1:])
                        else:
                            lines.append(f'{colour}\033[1m{name} MIN {low:+.6f} | MAX {high:+.6f} deg/s | ATTITUDE {angle}\033[0m')
                        if graph_height >= 3 and cols >= 30:
                            for i, line in enumerate(trace(visible, width, axis_scale, graph_height)):
                                label = f'{axis_scale:+.3g}' if i == 0 else '0' if i == graph_height // 2 else f'{-axis_scale:+.3g}' if i == graph_height - 1 else ''
                                lines.append(f'{colour}{"" if large_extrema else f"{label:>10} |"}{line}\033[0m')
                    if not large_extrema:
                        lines.append(f'Gyro age в последнем пакете: {latest[2]} us | график: последние IMU samples')
                        lines.append('AUTO Y: оси независимы; сужение через 0.5 s. A: включить/выключить AUTO.')
                if graph_height < 3 or cols < 30:
                    lines = lines[:5] + [line for line in lines[5:] if 'angle ' in line or 'mean ' in line or 'MIN ' in line] + ['Увеличьте окно для графиков; крупные MIN/MAX доступны от 85 x 50.']
                # Zoom can resize the terminal while a frame is being built.
                # Drop that frame instead of writing rows using obsolete bounds.
                if shutil.get_terminal_size((100, 36)) != (cols, rows):
                    continue
                clear = '\033[2J' if last_size != (cols, rows) else ''
                last_size = (cols, rows)
                sys.stdout.write(clear + '\033[H' + '\r\n'.join(fit_line(line, cols - 1) + '\033[K' for line in lines[:max(1, rows - 1)]) + '\033[J')
                sys.stdout.flush()
        finally:
            sys.stdout.write('\033[0m\033[?25h\n')
            sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='COM3')
    parser.add_argument('--baud', type=int, default=250000, help='Для USB номинальная скорость не ограничивает поток')
    parser.add_argument('--scale', type=float, default=.5, help='Половина диапазона графиков, deg/s')
    parser.add_argument('--no-auto-scale', action='store_true', help='Отключить автоматический диапазон Y (также клавиша A)')
    args = parser.parse_args()
    if not math.isfinite(args.scale) or args.scale <= 0:
        parser.error('Нужен конечный scale > 0')
    try:
        run(args)
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        raise SystemExit(f'Ошибка порта: {exc}')


if __name__ == '__main__':
    main()
