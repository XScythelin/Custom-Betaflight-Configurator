#!/usr/bin/env python3
"""Capture current VT MSP snapshots or listen to the duplex telemetry stream."""

from __future__ import annotations

import argparse
import csv
import struct
import time
from pathlib import Path
from typing import BinaryIO, Callable, NamedTuple, TypedDict

MSP_RC = 105
MSP2_VT_TELEMETRY_SNAPSHOT = 0x300E
MSP2_VT_TELEMETRY_SNAPSHOT_EXTENDED = 0x300F
MSP2_VT_TELEMETRY_IMU = 0x3010
MSP2_VT_TELEMETRY_STATE = 0x3011
MSP2_VT_TELEMETRY_MAG = 0x3012
UNKNOWN_AGE_US = 0xFFFFFFFF
MAX_PAYLOAD_SIZE = 4112 + 6  # Include the inner header and CRC of MSPv2-over-v1.
SOURCE_NAMES = ("acc", "gyro", "mag", "attitude", "altitude")


class Snapshot(TypedDict, total=False):
    snapshot_time_us: int
    acc_age_us: int
    gyro_age_us: int
    mag_age_us: int
    altitude_age_us: int
    attitude_age_us: int
    final_throttle_age_us: int
    acc: list[float]
    gyro: list[float]
    mag: list[float]
    attitude: list[int]
    altitude_cm: int | None
    vario_cm_s: int
    battery_voltage: int
    armed: int
    failsafe: int
    flight_mode_flags: int
    final_throttle_permille: int
    radio_throttle_us: int | None
    acc_age_saturated: bool
    gyro_age_saturated: bool
    altitude_age_saturated: bool
    attitude_age_saturated: bool
    final_throttle_age_saturated: bool
    mag_age_saturated: bool


class MspFrame(NamedTuple):
    command: int
    payload: bytes
    error: bool
    flags: int = 0


def crc8_dvb_s2(data: bytes) -> int:
    crc = 0
    for value in data:
        crc ^= value
        for _ in range(8):
            crc = ((crc << 1) ^ 0xD5) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def msp_v2_request(command: int, payload: bytes = b"") -> bytes:
    if not 0 <= command <= 0xFFFF or len(payload) > 0xFFFF:
        raise ValueError("MSPv2 command or payload size is out of range")
    body = bytes((0,)) + struct.pack("<HH", command, len(payload)) + payload
    return b"$X<" + body + bytes((crc8_dvb_s2(body),))


class MspReader:
    """One reader per connection; retain fragmented frames across timeouts."""

    def __init__(self, port: BinaryIO) -> None:
        self.port = port
        self.buffer = bytearray()
        self.invalid_frames = 0

    def pop_frame(self) -> MspFrame | None:
        while self.buffer:
            start = self.buffer.find(b"$")
            if start < 0:
                self.buffer.clear()
                return None
            del self.buffer[:start]
            if len(self.buffer) < 3:
                return None
            if self.buffer[1] not in (ord("M"), ord("X")) or self.buffer[2] not in (ord(">"), ord("!")):
                del self.buffer[0]
                continue
            native = self.buffer[1] == ord("X")
            header_size = 8 if native else 5
            if len(self.buffer) < header_size:
                return None
            if native:
                flags, command, size = struct.unpack_from("<BHH", self.buffer, 3)
            else:
                size, command = self.buffer[3:5]
                flags = 0
                if size == 255:
                    header_size = 7
                    if len(self.buffer) < header_size:
                        return None
                    size = struct.unpack_from("<H", self.buffer, 5)[0]
            if size > MAX_PAYLOAD_SIZE:
                self.invalid_frames += 1
                del self.buffer[0]
                continue
            frame_size = header_size + size + 1
            if len(self.buffer) < frame_size:
                return None
            frame = bytes(self.buffer[:frame_size])
            checksum = crc8_dvb_s2(frame[3:-1]) if native else self.xor_checksum(frame[3:-1])
            if checksum != frame[-1]:
                self.invalid_frames += 1
                del self.buffer[0]
                continue
            del self.buffer[:frame_size]
            payload = frame[header_size:-1]
            if not native and command == 255:
                if len(payload) < 6:
                    self.invalid_frames += 1
                    continue
                flags, command, inner_size = struct.unpack_from("<BHH", payload)
                if inner_size != len(payload) - 6 or crc8_dvb_s2(payload[:-1]) != payload[-1]:
                    self.invalid_frames += 1
                    continue
                payload = payload[5:-1]
            return MspFrame(command, payload, frame[2] == ord("!"), flags)
        return None

    @staticmethod
    def xor_checksum(data: bytes) -> int:
        checksum = 0
        for value in data:
            checksum ^= value
        return checksum

    def read_frame(self, timeout: float) -> MspFrame | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            frame = self.pop_frame()
            if frame is not None:
                return frame
            self.buffer.extend(self.port.read(1))
        return self.pop_frame()

    def read_response(self, command: int, timeout: float,
                      on_frame: Callable[[MspFrame], None] | None = None) -> bytes | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            frame = self.read_frame(deadline - time.monotonic())
            if frame is None:
                return None
            if frame.command == command:
                if frame.error:
                    raise RuntimeError(f"FC rejected MSP command 0x{command:04X}")
                return frame.payload
            if on_frame is not None:
                on_frame(frame)
        return None


def read_snapshot_payload(port: BinaryIO, timeout: float) -> bytes | None:
    return MspReader(port).read_response(MSP2_VT_TELEMETRY_SNAPSHOT, timeout)


def decode_snapshot(payload: bytes, command: int = MSP2_VT_TELEMETRY_SNAPSHOT) -> Snapshot:
    if command in (MSP2_VT_TELEMETRY_IMU, MSP2_VT_TELEMETRY_STATE, MSP2_VT_TELEMETRY_MAG):
        return decode_split_snapshot(payload, command)
    if command not in (MSP2_VT_TELEMETRY_SNAPSHOT, MSP2_VT_TELEMETRY_SNAPSHOT_EXTENDED):
        raise ValueError(f"Not a telemetry snapshot: 0x{command:04X}")
    include_mag = command == MSP2_VT_TELEMETRY_SNAPSHOT
    expected_size = 70 if include_mag else 56
    if len(payload) != expected_size:
        raise ValueError(f"snapshot 0x{command:04X} is {len(payload)} bytes, expected {expected_size}")
    data = struct.unpack_from("<I5H6f2hH2h4H", payload)
    flags = data[18]
    radio_throttle = data[20]
    if radio_throttle != 65535 and not 1000 <= radio_throttle <= 2000:
        raise ValueError(f"Invalid radio throttle: {radio_throttle}")
    result: Snapshot = {
        "snapshot_time_us": data[0],
        "acc_age_us": UNKNOWN_AGE_US if data[1] == 65535 else data[1],
        "gyro_age_us": UNKNOWN_AGE_US if data[2] == 65535 else data[2],
        "altitude_age_us": UNKNOWN_AGE_US if data[3] == 65535 else data[3],
        "attitude_age_us": UNKNOWN_AGE_US if data[4] == 65535 else data[4],
        "final_throttle_age_us": UNKNOWN_AGE_US if data[5] == 65535 else data[5],
        "acc_age_saturated": data[1] == 65534,
        "gyro_age_saturated": data[2] == 65534,
        "altitude_age_saturated": data[3] == 65534,
        "attitude_age_saturated": data[4] == 65534,
        "final_throttle_age_saturated": data[5] == 65534,
        "acc": list(data[6:9]),
        "gyro": list(data[9:12]),
        "attitude": list(data[12:15]),
        "altitude_cm": None if data[15] == -32768 else data[15],
        "vario_cm_s": data[16],
        "battery_voltage": data[17],
        "armed": flags & 1,
        "failsafe": int(bool(flags & 0x0400)),
        "flight_mode_flags": flags,
        "final_throttle_permille": data[19],
        "radio_throttle_us": None if radio_throttle == 65535 else radio_throttle,
    }
    if include_mag:
        mag_age, *mag = struct.unpack_from("<H3f", payload, 56)
        result["mag_age_us"] = UNKNOWN_AGE_US if mag_age == 65535 else mag_age
        result["mag_age_saturated"] = mag_age == 65534
        result["mag"] = mag
    return result


def decode_split_snapshot(payload: bytes, command: int) -> Snapshot:
    imu = command == MSP2_VT_TELEMETRY_IMU
    if command not in (MSP2_VT_TELEMETRY_IMU, MSP2_VT_TELEMETRY_STATE, MSP2_VT_TELEMETRY_MAG):
        raise ValueError(f"Not a split telemetry packet: 0x{command:04X}")
    size = 32 if imu else 18 if command == MSP2_VT_TELEMETRY_MAG else 28
    if len(payload) != size:
        raise ValueError(f"snapshot 0x{command:04X} is {len(payload)} bytes, expected {size}")
    result: Snapshot = {"snapshot_time_us": struct.unpack_from("<I", payload)[0]}
    def age(offset: int) -> tuple[int, bool]:
        value = struct.unpack_from("<H", payload, offset)[0]
        return (UNKNOWN_AGE_US if value == 65535 else value, value == 65534)
    if command == MSP2_VT_TELEMETRY_MAG:
        result["mag_age_us"], result["mag_age_saturated"] = age(4)
        result["mag"] = list(struct.unpack_from("<3f", payload, 6))
    elif imu:
        result["acc_age_us"], result["acc_age_saturated"] = age(4)
        result["acc"] = list(struct.unpack_from("<3f", payload, 6))
        result["gyro_age_us"], result["gyro_age_saturated"] = age(18)
        result["gyro"] = list(struct.unpack_from("<3f", payload, 20))
    else:
        result["attitude_age_us"], result["attitude_age_saturated"] = age(4)
        result["attitude"] = list(struct.unpack_from("<hhH", payload, 6))
        result["altitude_age_us"], result["altitude_age_saturated"] = age(12)
        altitude, vario, battery, flags, _, throttle, radio = struct.unpack_from("<hh5H", payload, 14)
        if radio != 65535 and not 1000 <= radio <= 2000:
            raise ValueError(f"Invalid radio throttle: {radio}")
        result["altitude_cm"] = None if altitude == -32768 else altitude
        result["vario_cm_s"] = vario
        result["battery_voltage"] = battery
        result["flight_mode_flags"] = flags
        result["armed"] = flags & 1
        result["failsafe"] = int(bool(flags & 0x0400))
        result["final_throttle_age_us"], result["final_throttle_age_saturated"] = age(22)
        result["final_throttle_permille"] = throttle
        result["radio_throttle_us"] = None if radio == 65535 else radio
    return result


def decode_rc(payload: bytes) -> list[int]:
    if len(payload) % 2 or len(payload) > 36:
        raise ValueError(f"Invalid MSP_RC payload size: {len(payload)}")
    return list(struct.unpack(f"<{len(payload) // 2}H", payload))


def open_port(args: argparse.Namespace):
    try:
        import serial
    except ImportError as exc:
        raise SystemExit("Install pyserial: python -m pip install -r build/requirements-msp-imu.txt") from exc
    return serial.Serial(args.port, baudrate=args.baud, timeout=min(args.timeout, 0.01), write_timeout=args.timeout)


def snapshot_row(snapshot: Snapshot) -> dict[str, int | str]:
    row: dict[str, int | str] = {}
    for key, value in snapshot.items():
        if value is None:
            row[key] = ""
        elif isinstance(value, int):
            row[key] = value
        elif isinstance(value, list):
            row[key] = ";".join(map(str, value))
        else:
            raise TypeError(f"Unsupported snapshot field {key}: {type(value).__name__}")
    return row


def write_capture(output: Path, rows: list[dict[str, int | str]]) -> None:
    if not rows:
        raise SystemExit("No valid telemetry snapshots received")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.with_suffix(".csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def add_arrival_ages(row: dict[str, int | str], rtt_us: int) -> None:
    for source in SOURCE_NAMES:
        age = int(row[f"{source}_age_us"])
        exact = age != UNKNOWN_AGE_US and not row[f"{source}_age_saturated"]
        row[f"{source}_arrival_age_lower_us"] = age
        row[f"{source}_arrival_age_estimate_us"] = age + rtt_us // 2 if exact else UNKNOWN_AGE_US
        row[f"{source}_arrival_age_upper_us"] = age + rtt_us if exact else UNKNOWN_AGE_US


def capture(args: argparse.Namespace) -> None:
    rows: list[dict[str, int | str]] = []
    timeouts = 0
    deadline = time.monotonic() + args.duration
    with open_port(args) as port:
        port.reset_input_buffer()
        reader = MspReader(port)
        while time.monotonic() < deadline:
            request_ns = time.monotonic_ns()
            request = msp_v2_request(MSP2_VT_TELEMETRY_SNAPSHOT)
            if port.write(request) != len(request):
                raise OSError("Incomplete MSP request write")
            payload = reader.read_response(MSP2_VT_TELEMETRY_SNAPSHOT, args.timeout)
            receive_ns = time.monotonic_ns()
            if payload is None:
                timeouts += 1
                continue
            snapshot = decode_snapshot(payload)
            row = snapshot_row(snapshot)
            rtt_us = (receive_ns - request_ns) // 1000
            row.update(host_request_ns=request_ns, host_receive_ns=receive_ns, rtt_us=rtt_us)
            add_arrival_ages(row, rtt_us)
            rows.append(row)
    write_capture(Path(args.output), rows)
    print(f"Frames: {len(rows)}; timeouts: {timeouts}; invalid frames: {reader.invalid_frames}; CSV: {Path(args.output).with_suffix('.csv')}")
    for source in SOURCE_NAMES:
        exact_rows = [row for row in rows if int(row[f"{source}_arrival_age_estimate_us"]) != UNKNOWN_AGE_US]
        ages = [int(row[f"{source}_age_us"]) for row in exact_rows]
        arrival_estimates = [int(row[f"{source}_arrival_age_estimate_us"]) for row in exact_rows]
        saturated = sum(bool(row[f"{source}_age_saturated"]) for row in rows)
        unknown = sum(int(row[f"{source}_age_us"]) == UNKNOWN_AGE_US for row in rows)
        print(f"{source}: saturated ages={saturated}; unknown ages={unknown}; statistics use exact ages only")
        if ages:
            print(f"{source}: FC mean={sum(ages) / len(ages) / 1000:.3f} ms, arrival estimate mean={sum(arrival_estimates) / len(arrival_estimates) / 1000:.3f} ms, max={max(arrival_estimates) / 1000:.3f} ms")
        else:
            print(f"{source}: no samples")


def listen(args: argparse.Namespace) -> None:
    rows: list[dict[str, int | str]] = []
    split_rows: dict[int, list[dict[str, int | str]]] = {
        MSP2_VT_TELEMETRY_IMU: [], MSP2_VT_TELEMETRY_STATE: [], MSP2_VT_TELEMETRY_MAG: [],
    }
    deadline = time.monotonic() + args.duration
    with open_port(args) as port:
        port.reset_input_buffer()
        reader = MspReader(port)
        while time.monotonic() < deadline:
            frame = reader.read_frame(args.timeout)
            receive_ns = time.monotonic_ns()
            if frame is None:
                continue
            if frame.error:
                raise RuntimeError(f"FC rejected MSP command 0x{frame.command:04X}")
            if frame.command == MSP2_VT_TELEMETRY_SNAPSHOT_EXTENDED or frame.command in split_rows:
                snapshot = decode_snapshot(frame.payload, frame.command)
                row = snapshot_row(snapshot)
                row.update(host_receive_ns=receive_ns)
                if frame.command == MSP2_VT_TELEMETRY_SNAPSHOT_EXTENDED:
                    rows.append(row)
                else:
                    split_rows[frame.command].append(row)
    if not rows and not any(split_rows.values()):
        raise SystemExit("No valid telemetry snapshots received")
    if rows:
        write_capture(Path(args.output), rows)
        print(f"Legacy 0x300F snapshots: {len(rows)}; CSV: {Path(args.output).with_suffix('.csv')}")
    for command, packets in split_rows.items():
        if packets:
            output = Path(args.output).with_name(Path(args.output).name + f"-{command:04x}")
            write_capture(output, packets)
            print(f"0x{command:04X} snapshots: {len(packets)}; CSV: {output.with_suffix('.csv')}")
    print(f"Invalid frames: {reader.invalid_frames}")


def benchmark(args: argparse.Namespace) -> None:
    received_ns: list[int] = []
    timeouts = 0
    deadline = time.monotonic() + args.duration
    with open_port(args) as port:
        port.reset_input_buffer()
        reader = MspReader(port)
        while time.monotonic() < deadline:
            request = msp_v2_request(MSP2_VT_TELEMETRY_SNAPSHOT)
            if port.write(request) != len(request):
                raise OSError("Incomplete MSP request write")
            payload = reader.read_response(MSP2_VT_TELEMETRY_SNAPSHOT, args.timeout)
            if payload is None:
                timeouts += 1
            else:
                decode_snapshot(payload)
                received_ns.append(time.monotonic_ns())
    if len(received_ns) < 2:
        raise SystemExit("Fewer than two valid snapshots received")
    intervals_us = [(right - left) / 1000 for left, right in zip(received_ns, received_ns[1:])]
    elapsed_s = (received_ns[-1] - received_ns[0]) / 1e9
    ordered = sorted(intervals_us)
    p50 = ordered[round((len(ordered) - 1) * 0.5)]
    p95 = ordered[round((len(ordered) - 1) * 0.95)]
    print(f"Frames: {len(received_ns)}; timeouts: {timeouts}; sustained rate: {(len(received_ns) - 1) / elapsed_s:.2f} Hz")
    print(f"Interval: min={min(intervals_us) / 1000:.3f} ms, p50={p50 / 1000:.3f} ms, p95={p95 / 1000:.3f} ms, max={max(intervals_us) / 1000:.3f} ms")


def add_connection_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", required=True)
    parser.add_argument("--baud", type=int, default=230400)
    parser.add_argument("--duration", type=float, default=10.0)
    parser.add_argument("--timeout", type=float, default=0.25)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    for name, function in (("capture", capture), ("listen", listen), ("benchmark", benchmark)):
        subparser = commands.add_parser(name)
        add_connection_arguments(subparser)
        if name != "benchmark":
            subparser.add_argument("--output", default="my/msp-imu/freshness")
        subparser.set_defaults(function=function)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    if arguments.duration <= 0 or arguments.timeout <= 0 or arguments.baud <= 0:
        raise SystemExit("Duration, timeout and baudrate must be positive")
    arguments.function(arguments)
