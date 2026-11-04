#!/usr/bin/env python3
"""Build a generic production APK and sign using a persistent, private release key.

The keystore lives outside the repo; its password is stored in macOS Keychain.
Never print signing secrets or fall back to a debug certificate.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
env = dict(os.environ)
env['PATH'] = str(Path.home() / '.cargo/bin') + ':' + env['PATH']
env.setdefault('JAVA_HOME', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home')
env.setdefault('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))
env.setdefault('NDK_HOME', env['ANDROID_HOME'] + '/ndk/28.2.13676358')
if env.get('VITE_COMPANION_FIXTURE') == '1':
    raise SystemExit('Fixture builds cannot be distributed')
env['VITE_COMPANION_FIXTURE'] = '0'
env.pop('FREDDAI_COMPANION_PROVISION', None)

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], env=env, check=True, **kwargs)

keydir = Path.home() / 'Library/Application Support/com.freddai.desktop/signing'
keydir.mkdir(mode=0o700, parents=True, exist_ok=True)
keydir.chmod(0o700)
key = keydir / 'android-release.p12'
service = 'com.freddai.android.release'
password = subprocess.run(['security', 'find-generic-password', '-s', service, '-a', 'release', '-w'], capture_output=True, text=True)
if not key.exists():
    if password.returncode == 0:
        raise SystemExit('Release password already exists but key is missing. Restore the existing key; refusing key rotation.')
    secret = secrets.token_urlsafe(36)
    # Keychain receives the secret through stdin to avoid process argument exposure.
    import tempfile
    with tempfile.TemporaryFile(mode='w+') as commands:
        commands.write(f'add-generic-password -s {service} -a release -w {secret}\n')
        commands.seek(0)
        run(['security', '-i'], stdin=commands, stdout=subprocess.DEVNULL)
else:
    if password.returncode != 0:
        raise SystemExit('Unlock the login Keychain to read the existing Android release password.')
    secret = password.stdout.strip()
env['FREDDAI_ANDROID_STORE_PASSWORD'] = secret
if not key.exists():
    run([Path(env['JAVA_HOME']) / 'bin/keytool', '-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-storepass:env', 'FREDDAI_ANDROID_STORE_PASSWORD', '-alias', 'freddai', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000', '-dname', 'CN=Freddai Android Release'])
    key.chmod(0o600)
if not Path('apps/native/src-tauri/gen/android').exists():
    run(['pnpm', '--filter', '@freddai/native', 'tauri', 'android', 'init', '--ci'])
run(['pnpm', '--filter', '@freddai/native', 'tauri', 'android', 'build', '--apk', '--target', 'aarch64'])
apks = list(Path('apps/native/src-tauri/gen/android/app/build/outputs/apk').glob('**/*release-unsigned.apk'))
if len(apks) != 1:
    raise SystemExit(f'Expected exactly one unsigned release APK; found {len(apks)}')
output = Path('output/android-release')
output.mkdir(parents=True, exist_ok=True)
tools = Path(env['ANDROID_HOME']) / 'build-tools/36.0.0'
aligned = output / 'aligned.apk'
asset = output / 'Freddai-android-arm64.apk'
run([tools / 'zipalign', '-f', '-P', '16', '4', apks[0], aligned])
run([tools / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'freddai', '--ks-pass', 'env:FREDDAI_ANDROID_STORE_PASSWORD', '--out', asset, aligned])
run([tools / 'apksigner', 'verify', '--verbose', '--print-certs', asset])
run([tools / 'zipalign', '-c', '-P', '16', '4', asset])
badging = run([tools / 'aapt', 'dump', 'badging', asset], capture_output=True, text=True).stdout
if 'application-debuggable' in badging or "native-code: 'arm64-v8a'" not in badging:
    raise SystemExit('APK must be non-debuggable ARM64')
# ZIP alignment alone does not prove the native library supports 16 KB pages.
with zipfile.ZipFile(asset) as archive:
    libraries = [n for n in archive.namelist() if n.startswith('lib/') and n.endswith('.so')]
    if not libraries:
        raise SystemExit('APK is missing native libraries')
    for name in libraries:
        data = archive.read(name)
        if data[:6] != b'\x7fELF\x02\x01':
            raise SystemExit('Expected a little-endian 64-bit ELF library')
        offset = struct.unpack_from('<Q', data, 32)[0]
        size, count = struct.unpack_from('<HH', data, 54)
        alignments = [struct.unpack_from('<Q', data, offset + i * size + 48)[0]
                      for i in range(count) if struct.unpack_from('<I', data, offset + i * size)[0] == 1]
        if not alignments or any(alignment < 16384 for alignment in alignments):
            raise SystemExit(f'{name} does not support 16 KB memory pages')
digest = hashlib.sha256(asset.read_bytes()).hexdigest()
(asset.with_suffix('.apk.sha256')).write_text(f'{digest}  {asset.name}\n')
(output / 'build.json').write_text(json.dumps({'sha256': digest, 'fixture': False, 'genericEnrollment': True, 'architecture': 'arm64-v8a', 'version': json.loads(Path('apps/native/src-tauri/tauri.conf.json').read_text())['version']}, indent=2) + '\n')
aligned.unlink()
print(f'Release ready: {asset} SHA-256 {digest}')
