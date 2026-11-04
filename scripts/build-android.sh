#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
fi
if [ -z "${NDK_HOME:-}" ]; then
  export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
fi
if [ ! -d "$NDK_HOME" ]; then
  echo 'Install Android SDK platforms 36 and 37, build-tools 36.0.0, platform-tools and NDK 28.2.13676358; set ANDROID_HOME and NDK_HOME.' >&2
  exit 1
fi
if [ ! -d apps/native/src-tauri/gen/android ]; then
  pnpm --filter @freddai/native tauri android init --ci
fi
# Debug signing is for local development only. Public releases use android:release.
pnpm --filter @freddai/native tauri android build --debug --apk --target "${FREDDAI_ANDROID_TARGET:-aarch64}" "$@"
