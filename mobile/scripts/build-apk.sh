#!/usr/bin/env bash
# Gera mobile/dist/MatchFlix.apk (APK debug, assinado com a chave de debug — instalável por sideload).
# Requisitos: Node 20+, JDK 21 e Android SDK (ANDROID_HOME) com platform 35 / build-tools 34.
# Usado pelo GitHub Actions (.github/workflows/android-apk.yml) e pelo mobile/Dockerfile.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Instalando dependências"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

if [ ! -d android ]; then
  echo "==> Criando o projeto Android (cap add android)"
  npx cap add android
fi

echo "==> Gerando ícones e splash a partir de assets/"
npx capacitor-assets generate --android

echo "==> Sincronizando www/ e capacitor.config.json"
npx cap sync android

# MainActivity própria: tela cheia de vídeo, botão Voltar, errorPath só p/ falha de rede e
# remoção da interface JS nativa (ver o comentário em native/MainActivity.java).
APP_ID="$(node -p "require('./capacitor.config.json').appId")"
ACTIVITY_DIR="android/app/src/main/java/$(echo "$APP_ID" | tr . /)"
[ -d "$ACTIVITY_DIR" ] || { echo "ERRO: pasta $ACTIVITY_DIR não existe (appId mudou?)" >&2; exit 1; }
cp native/MainActivity.java "$ACTIVITY_DIR/MainActivity.java"
grep -q "^package $APP_ID;" "$ACTIVITY_DIR/MainActivity.java" || {
  echo "ERRO: o 'package' de native/MainActivity.java não bate com o appId ($APP_ID)" >&2
  exit 1
}
# Sem 'orientation' em configChanges, girar a tela para o vídeo em tela cheia recriaria a Activity.
grep -q 'configChanges="[^"]*orientation' android/app/src/main/AndroidManifest.xml ||
  echo "AVISO: AndroidManifest sem configChanges=orientation; a tela cheia pode reiniciar o app ao girar." >&2

# O servidor MatchFlix costuma rodar em HTTP na LAN; o Android 9+ bloqueia HTTP puro por padrão.
# `server.cleartext` já deveria fazer isso, mas garantimos (e conferimos) direto no manifest.
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q 'android:usesCleartextTraffic="true"' "$MANIFEST"; then
  sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$MANIFEST"
fi
grep -q 'android:usesCleartextTraffic="true"' "$MANIFEST" || {
  echo "ERRO: não foi possível habilitar usesCleartextTraffic em $MANIFEST" >&2
  exit 1
}

echo "==> Compilando (gradle assembleDebug)"
(cd android && ./gradlew --no-daemon assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "ERRO: APK não encontrado em $APK" >&2; exit 1; }

mkdir -p dist
cp "$APK" dist/MatchFlix.apk
echo "==> Pronto: mobile/dist/MatchFlix.apk"
