"""Общий выбор последовательного порта для консольных инструментов."""

from pathlib import Path
import subprocess
import sys


def scan_ports():
    from serial.tools import list_ports
    return sorted(list_ports.comports(), key=lambda p: (len(p.device), p.device))


def choose_port(scan=scan_ports, ask=input, output=print):
    while True:
        ports = scan()
        output('\nДоступные порты:')
        for i, port in enumerate(ports, 1):
            output(f'  {i}. {port.device} — {port.description or "без описания"}')
        if not ports:
            output('  COM-порты не найдены. Подключите плату и повторите поиск.')
        choice = ask('Номер порта | R/Enter — повторить поиск | Q — выход: ').strip().lower()
        if choice == 'q':
            return None
        if choice in ('', 'r'):
            continue
        if choice.isdecimal() and 1 <= int(choice) <= len(ports):
            return ports[int(choice) - 1].device
        output('Неверный выбор.')


def launch(tool):
    print('Закройте Configurator и другие программы, использующие COM-порт.')
    try:
        while (port := choose_port()) is not None:
            script = Path(__file__).resolve().with_name(tool)
            args = [sys.executable, str(script), '--port', port]
            if tool == 'gyro_live.py':
                args += ['--scale', '0.05']
            result = subprocess.run(args, check=False)
            print(f'\nПрограмма завершена (код {result.returncode}). Можно выбрать порт снова.')
    except ImportError:
        raise SystemExit('Установите pyserial: python -m pip install pyserial')
    except (KeyboardInterrupt, EOFError):
        print('\nВыход.')


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('gyro_live.py', 'fc_cli.py'):
        raise SystemExit('Использование: com_tools.py gyro_live.py|fc_cli.py')
    launch(sys.argv[1])
