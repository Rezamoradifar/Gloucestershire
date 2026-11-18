import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import runpy
import tempfile
import threading
import unittest

check = runpy.run_path("scripts/check-v3-unified-route.py")["check"]


class Fallback(SimpleHTTPRequestHandler):
    def do_GET(self):
        if not Path(self.translate_path(self.path)).exists():
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, *args):
        pass


class DashboardDelivery(unittest.TestCase):
    def test_entire_app_loads_and_rejects_html_served_for_lazy_dashboard(self):
        with tempfile.TemporaryDirectory() as storage:
            root = Path(storage)
            dist = root / "dist"
            public = root / "public"
            for folder in [dist, public]:
                (folder / "assets").mkdir(parents=True)
                (folder / "index.html").write_text('<script type="module" src="./assets/index.js"></script>'
                                                   '<link rel="stylesheet" href="./assets/site.css">')
                for name in ["index.js", "site.css", "V3Dashboard-test.js"]:
                    (folder / "assets" / name).write_text("/* test */")
            server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Fallback, directory=public))
            try:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                origin = f"http://127.0.0.1:{server.server_port}/"
                check(dist, root, origin, resolver=())
                (public / "assets" / "V3Dashboard-test.js").unlink()
                with self.assertRaisesRegex(ValueError, "UNIFIED_SITE_ASSET_NOT_SERVED: assets/V3Dashboard-test.js"):
                    check(dist, root, origin, resolver=())
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
