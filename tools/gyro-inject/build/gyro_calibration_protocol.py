"""Кодирование MSP-поправок гироскопа без потери float32-точности."""

from __future__ import annotations

import math
import struct

START = 0x3013
SET = 0x3014
RESULT = 0x3015
CURRENT = 0x3016
GROUND_SAVE = 0x3017
HEADER = struct.Struct("<B")
SENSOR = struct.Struct("<3f")


def decode_result(payload: bytes) -> dict:
    if len(payload) < HEADER.size or (len(payload) - HEADER.size) % SENSOR.size:
        raise ValueError("Неверная длина результата")
    success, = HEADER.unpack_from(payload)
    records = list(SENSOR.iter_unpack(payload[HEADER.size:]))
    if not records or len(records) > 8 or success > 1:
        raise ValueError("Неверный статус")
    for zero in records:
        if any(not math.isfinite(x) or abs(x) > 32767 for x in zero):
            raise ValueError("Неверные поправки")
    return dict(success=bool(success), records=records)


def restore_request(result_payload: bytes) -> bytes:
    """Возвращает SET payload из завершённого успешного RESULT.

    Байты поправок копируются непосредственно: база должна хранить исходный
    payload, а не округлённое текстовое представление. CURRENT не принимается
    автоматически: он не содержит признака успеха.
    """
    result = decode_result(result_payload)
    if not result["success"]:
        raise ValueError("Нужен завершённый успешный RESULT")
    return result_payload[HEADER.size:]
