#!/usr/bin/env python3
"""Store a separate mainnet RPC using the reviewed private-input writer."""
from pathlib import Path
import runpy
import sys
if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('MAINNET_RPC_INPUT_TAKES_NO_ARGUMENTS')
    helper=runpy.run_path(str(Path(__file__).with_name('save-zero-archive-rpc.py')))
    raise SystemExit(helper['main'](file=Path('/etc/globaldroptrade/mainnet-rpc-url'),
        prompt='BNB Mainnet 56 archive HTTPS RPC URL (hidden): '))
