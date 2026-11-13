#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('prune-retired-v3-site-assets.py')
spec = importlib.util.spec_from_file_location('retire_assets', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PruneRetiredAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'site'
        self.build = Path(self.temp.name) / 'build'
        for p in (self.root, self.build):
            (p / 'assets').mkdir(parents=True)
            (p / 'index.html').write_text('current index')
            (p / 'assets' / 'index-12345678.js').write_text('current js')
            (p / 'assets' / 'main-abcdefgh.css').write_text('current css')

    def test_selects_only_obsolete_hashed_scripts_and_styles(self):
        assets = self.root / 'assets'
        (assets / 'V2Dashboard-87654321.js').write_text('retired')
        (assets / 'legacy-abcdefgh.css').write_text('retired')
        (assets / 'api-config.json').write_text('other service')
        (assets / 'shared-87654321.js').symlink_to(assets / 'api-config.json')
        self.assertEqual([p.name for p in module.retired_files(self.root, self.build)],
                         ['V2Dashboard-87654321.js', 'legacy-abcdefgh.css'])
        for path in module.retired_files(self.root, self.build):
            path.unlink()
        self.assertEqual((assets / 'index-12345678.js').read_text(), 'current js')
        self.assertEqual((assets / 'api-config.json').read_text(), 'other service')
        self.assertTrue((assets / 'shared-87654321.js').is_symlink())

    def test_blocks_cleanup_if_served_index_or_current_asset_differs(self):
        stale = self.root / 'assets' / 'V2Dashboard-87654321.js'
        stale.write_text('retired')
        (self.root / 'index.html').write_text('different index')
        with self.assertRaisesRegex(ValueError, 'CURRENT_INDEX_MISMATCH'):
            module.retired_files(self.root, self.build)
        (self.root / 'index.html').write_text('current index')
        (self.root / 'assets' / 'index-12345678.js').write_text('wrong js')
        with self.assertRaisesRegex(ValueError, 'CURRENT_ASSET_MISMATCH'):
            module.retired_files(self.root, self.build)
        self.assertTrue(stale.exists())


if __name__ == '__main__':
    unittest.main()
