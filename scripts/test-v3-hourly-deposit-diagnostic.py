import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('diagnose', Path(__file__).with_name('diagnose-v3-hourly-deposit.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
WALLET = '0x786ebc9ea12ed00616e538dd35a78dc8e12ffdf6'
REFERRER = '0x2f980ac9ae92db23ca2aead1ce8188a5764a7bfa'
AMOUNT = 1000 * 10**18


def uint(value):
    return '0x' + format(value, '064x')


def user(referrer=d.ZERO, registered=False, suspended=False, vip=False, capital=0):
    values = [int(referrer, 16), int(registered), int(suspended), int(vip), 0, 0, 0, capital, 0, 0, 0, 0, 0]
    return '0x' + ''.join(format(value, '064x') for value in values)


class FakeRpc:
    def __init__(self, registered=False, saved_referrer=d.ZERO, sponsor=False):
        self.registered, self.saved_referrer, self.sponsor = registered, saved_referrer, sponsor
        self.methods = []
        self.blocks = 0
        self.reorg = False
        self.allowance = AMOUNT
        self.balance = AMOUNT * 10

    def __call__(self, method, params):
        self.methods.append(method)
        if method == 'eth_chainId':
            return '0x61'
        if method == 'eth_blockNumber':
            return hex(123)
        if method == 'eth_getBlockByNumber':
            self.blocks += 1
            return {'hash': '0x' + ('2' if self.reorg and self.blocks > 1 else '1') * 64}
        if method == 'eth_getCode':
            return '0x6001'
        if method == 'eth_call':
            tx, block = params
            assert block == hex(120)
            data = tx['data'].lower()
            if data.startswith('0x38d52e0f'):
                return uint(int(d.TOKEN, 16))
            if data.startswith('0x5c975abb'):
                return uint(0)
            if data.startswith('0xa87430ba'):
                account = '0x' + data[-40:]
                if account == WALLET:
                    return user(self.saved_referrer, self.registered)
                if account == REFERRER:
                    return user(registered=self.sponsor)
            if data.startswith('0x70a08231'):
                return uint(self.balance)
            if data.startswith('0xdd62ed3e'):
                return uint(self.allowance)
            if data.startswith('0x6e553f65'):
                assert tx['from'] == WALLET
                raise d.RpcError({'data': '0x6dac6a09', 'message': 'private RPC message'})
        raise AssertionError('Unexpected RPC method or data')


class DepositDiagnosticTests(unittest.TestCase):
    def test_unregistered_referrer_and_exact_simulation_error(self):
        rpc = FakeRpc()
        result = d.inspect(rpc, WALLET, REFERRER, AMOUNT)
        self.assertEqual(result['amountTest'], '1000.0')
        self.assertFalse(result['referrerRegisteredHere'])
        self.assertIn('REFERRER_NOT_REGISTERED_ON_HOURLY_CONTRACT', result['reasons'])
        self.assertEqual(result['simulation']['selector'], '0x6dac6a09')
        self.assertNotIn('private RPC message', str(result))
        self.assertTrue(set(rpc.methods).issubset(d.ALLOWED))

    def test_registered_account_with_different_permanent_referrer(self):
        rpc = FakeRpc(registered=True, saved_referrer=d.ZERO, sponsor=True)
        result = d.inspect(rpc, WALLET, REFERRER, AMOUNT)
        self.assertIn('PERMANENT_REFERRER_MISMATCH', result['reasons'])
        self.assertNotIn('REFERRER_NOT_REGISTERED_ON_HOURLY_CONTRACT', result['reasons'])

    def test_low_balance_and_allowance_are_reported_separately(self):
        rpc = FakeRpc(sponsor=True)
        rpc.balance, rpc.allowance = 0, 0
        result = d.inspect(rpc, WALLET, REFERRER, AMOUNT)
        self.assertIn('INSUFFICIENT_TEST_TOKEN_BALANCE', result['reasons'])
        self.assertIn('TEST_TOKEN_ALLOWANCE_BELOW_AMOUNT', result['reasons'])
        self.assertNotIn('REFERRER_NOT_REGISTERED_ON_HOURLY_CONTRACT', result['reasons'])

    def test_changing_confirmed_block_is_rejected(self):
        rpc = FakeRpc()
        rpc.reorg = True
        with self.assertRaisesRegex(ValueError, 'BLOCK_CHANGED'):
            d.inspect(rpc, WALLET, REFERRER, AMOUNT)

    def test_amount_is_exact_and_input_is_validated(self):
        self.assertEqual(d.amount_units('1000.000001'), 1000000001000000000000)
        self.assertEqual(d.display(1), '0.000000000000000001')
        with self.assertRaises(ValueError):
            d.amount_units('1e6')
        with self.assertRaises(ValueError):
            d.address('not-an-address')


if __name__ == '__main__':
    unittest.main()
