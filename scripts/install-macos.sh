#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Concurrent implementation threads share the bundle output. Serialize the full
# build/sign/install transaction so one build cannot remove another's signing input.
if [ "${FREDDAI_INSTALL_SERIALIZED:-}" != "1" ]; then
  exec python3 - "$0" "$@" <<'LOCK'
import fcntl, os, pathlib, subprocess, sys
pathlib.Path('target').mkdir(exist_ok=True)
with open('target/.native-install.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    env = dict(os.environ, FREDDAI_INSTALL_SERIALIZED='1')
    sys.exit(subprocess.call(['bash', sys.argv[1], *sys.argv[2:]], env=env))
LOCK
fi
# Non-login shells may lack cargo and the corepack pnpm shim.
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v pnpm >/dev/null; then
  shim="$(mktemp -d)"
  corepack enable --install-directory "$shim"
  export PATH="$shim:$PATH"
fi
# Marks this as a local build: the in-app updater stays quiet about published releases.
FREDDAI_LOCAL_BUILD=1 pnpm --filter @freddai/native tauri build --bundles app
# Stamp the build before signing so the signature seals it.
build_sha="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then build_sha="$build_sha-dirty"; fi
printf '%s\n' "$build_sha" > target/release/bundle/macos/Freddai.app/Contents/Resources/build-sha
echo "Build: $build_sha"
# Use an explicitly selected identity, or the only available Developer ID identity.
identity="${FREDDAI_SIGNING_IDENTITY:-}"
if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning | awk '/"Developer ID Application:/ {print $2}')"
  if [ "$(printf '%s\n' "$identity" | wc -w | tr -d ' ')" != "1" ]; then
    echo 'Set FREDDAI_SIGNING_IDENTITY to the intended Developer ID identity.' >&2
    exit 1
  fi
fi
codesign --force --options runtime --timestamp --identifier com.freddai.computer --sign "$identity" "target/release/bundle/macos/Freddai.app/Contents/Resources/computer-use/Freddai Computer.app"
codesign --force --options runtime --timestamp --identifier com.freddai.bugwalk --sign "$identity" "target/release/bundle/macos/Freddai.app/Contents/Resources/bug-walk/Freddai Bug Walk.app"
codesign --force --options runtime --entitlements apps/native/src-tauri/Entitlements.plist --timestamp --identifier com.freddai.desktop --sign "$identity" target/release/bundle/macos/Freddai.app
python3 - <<'PY'
import os, subprocess, tempfile, uuid
from pathlib import Path
source=Path('target/release/bundle/macos/Freddai.app').resolve()
dest=Path('/Applications/Freddai.app')
stage=dest.parent/('.Freddai-update-'+str(uuid.uuid4())+'.app')
subprocess.run(['ditto',str(source),str(stage)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(stage)],check=True)
backup=Path(tempfile.mkdtemp(prefix='freddai-install-backup-'))/'Freddai.app'
if dest.exists(): os.rename(dest,backup)
try: os.rename(stage,dest)
except Exception:
    if backup.exists(): os.rename(backup,dest)
    raise
subprocess.run(['codesign','--verify','--deep','--strict','--verbose=2',str(dest)],check=True)
print('Installed:',dest)
print('Previous bundle preserved:',backup)
# Report each running process once, by role, with the executable it actually mapped.
# pgrep -f misses the long host-binaries path, so scan ps instead.
pids=[l.split(None,1)[0] for l in subprocess.run(['ps','-axo','pid=,command='],capture_output=True,text=True).stdout.splitlines() if '/Contents/MacOS/freddai-native' in l]
current=str(dest/'Contents/MacOS/freddai-native')
for pid in pids:
    args=subprocess.run(['ps','-o','command=','-p',pid],capture_output=True,text=True).stdout
    role='background host (self-upgrades when idle)' if ' --host ' in args else 'companion server' if '--companion-server' in args else 'agent watcher' if '--watch-process' in args else 'app window'
    out=subprocess.run(['lsof','-a','-p',pid,'-d','txt','-Fn'],capture_output=True,text=True).stdout
    path=next((s[1:] for s in out.splitlines() if s.startswith('n') and s.endswith('/Contents/MacOS/freddai-native')),'?')
    print(f'Running {role} (pid {pid}):', 'current build' if path==current else f'older build {path}')
    if role=='app window' and path!=current:
        print('RESTART REQUIRED: save your draft, quit Freddai, then reopen /Applications/Freddai.app.')
PY
# Cached host copies share the bundle id; make LaunchServices resolve only /Applications.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for cached in "$HOME/Library/Application Support/com.freddai.desktop/host-binaries/"*.app; do
  [ -e "$cached" ] || continue
  "$LSREGISTER" -u "$cached" || echo "WARNING: lsregister -u failed for $cached" >&2
done
"$LSREGISTER" -f /Applications/Freddai.app
resolved="$(osascript -e 'POSIX path of (path to application id "com.freddai.desktop")')"
if [ "$resolved" != "/Applications/Freddai.app/" ]; then
  echo "ERROR: bundle id com.freddai.desktop resolves to '$resolved', expected /Applications/Freddai.app/" >&2
  exit 1
fi
echo "Bundle id resolves to: $resolved"
echo "Installed build: $(cat /Applications/Freddai.app/Contents/Resources/build-sha)"
