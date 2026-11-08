import hashlib
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]

class LinuxArchiveTest(unittest.TestCase):
    def test_browser_download_becomes_executable_without_changing_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            app = folder / 'download.AppImage'
            app.write_bytes(b'\x7fELF downloaded AppImage fixture')
            app.chmod(0o644)
            output = folder / 'Freddai-linux-x64.tar.gz'
            subprocess.run(['python3', str(ROOT / 'scripts/package-linux-archive.py'), str(app), str(output)], check=True)
            with tarfile.open(output) as archive:
                member = archive.getmember('Freddai-linux-x64/Freddai-linux-x64.AppImage')
                self.assertEqual(member.mode, 0o755)
                self.assertEqual(hashlib.sha256(archive.extractfile(member).read()).digest(), hashlib.sha256(app.read_bytes()).digest())
                self.assertIn(b'Omarchy', archive.extractfile('Freddai-linux-x64/README.md').read())
            self.assertEqual(app.stat().st_mode & 0o777, 0o644)

if __name__ == '__main__':
    unittest.main()
