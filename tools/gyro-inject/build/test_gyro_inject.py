import struct
import unittest
from unittest.mock import Mock

from gyro_inject import detect_parameters, inject, target_offsets


class SafetyTests(unittest.TestCase):
    def client(self, sensor=15, startup='OFF', current=bytes(12)):
        client = Mock()
        client.request.side_effect = lambda code, *args, **kwargs: {
            1: bytes((0, 1, 47)), 0x300D: bytes((1, sensor)), 0x3016: current,
        }[code]
        client.cli.return_value = f'gyro_cal_on_startup = {startup}\n'
        return client

    def test_api_147_bmi270_index(self):
        self.assertEqual(detect_parameters(self.client()), ('BMI270', 2000 / 32768))

    def test_unknown_and_variable_range_never_start(self):
        for sensor in (0, 5, 10, 12, 255):
            client = self.client(sensor)
            with self.assertRaises(RuntimeError):
                inject(client, (1, 2, 3))
            self.assertNotIn(0x3013, [call.args[0] for call in client.request.call_args_list])

    def test_startup_calibration_never_start(self):
        client = self.client(startup='ON')
        with self.assertRaises(RuntimeError):
            inject(client, (0, 0, 0))
        self.assertNotIn(0x3013, [call.args[0] for call in client.request.call_args_list])

    def test_multiple_zeros_rejected(self):
        with self.assertRaises(RuntimeError):
            detect_parameters(self.client(current=bytes(24)))

    def test_dynamic_names_not_legacy_indices(self):
        client = self.client(sensor=2)
        client.request.side_effect = lambda code: {
            1: bytes((0, 1, 48)), 0x300D: bytes((1, 2)), 0x3016: bytes(12),
        }[code]
        client.cli.side_effect = ['gyro: AUTO,NONE,BMI270\n', 'gyro_cal_on_startup = OFF\n']
        self.assertEqual(detect_parameters(client)[0], 'BMI270')

    def test_detected_multiple_sensors_rejected(self):
        client = self.client()
        client.request.side_effect = lambda code: {
            1: bytes((0, 1, 47)), 0x300D: bytes((2, 15, 15)),
        }[code]
        with self.assertRaises(RuntimeError):
            inject(client, (0, 0, 0))
        self.assertNotIn(0x3013, [call.args[0] for call in client.request.call_args_list])

    def test_set_readback_mismatch_never_saves(self):
        client = self.client()
        def request(code, payload=b'', **kwargs):
            return {1: bytes((0, 1, 47)), 0x300D: bytes((1, 15)),
                    0x3016: bytes(12), 0x3013: b'\x01' + bytes(12),
                    0x3014: b'\x01' + payload}[code]
        client.request.side_effect = request
        with self.assertRaisesRegex(RuntimeError, 'не совпали'):
            inject(client, (1, 0, 0))
        self.assertNotIn(0x3017, [call.args[0] for call in client.request.call_args_list])

    def test_raw_axes_have_same_sign(self):
        result = struct.unpack('<3f', target_offsets(bytes(12), (1, 1, 1), 0.5))
        self.assertEqual(result, (-2, -2, -2))

    def test_reject_nonfinite_and_limits(self):
        for error in (float('nan'), float('inf'), 10.01):
            with self.assertRaises(ValueError):
                target_offsets(bytes(12), (error, 0, 0), 0.5)


if __name__ == '__main__':
    unittest.main()
