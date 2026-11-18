# Ambiente de build do APK (JDK 21 + Node 22 + Android SDK), sem instalar nada na máquina.
#
#   npm run apk:docker      (na raiz do repositório)
#
# Equivale a:
#   docker build --target apk --output type=local,dest=mobile/dist mobile
#
# A primeira execução baixa ~2–3 GB (SDK Android + Gradle); as seguintes usam o cache do Docker.
# Requer Docker com BuildKit (padrão no Docker Desktop).

FROM eclipse-temurin:21-jdk AS build

ARG NODE_MAJOR=22
ARG CMDLINE_TOOLS=11076708
ARG ANDROID_PLATFORM=35
ARG ANDROID_BUILD_TOOLS=34.0.0

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    DEBIAN_FRONTEND=noninteractive
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip git \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
 && curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip" \
 && unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
 && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
 && rm /tmp/cmdline-tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "platforms;android-${ANDROID_PLATFORM}" "build-tools;${ANDROID_BUILD_TOOLS}"

WORKDIR /app
COPY . .
RUN bash scripts/build-apk.sh

# Estágio só com o APK, para `--output` exportá-lo para o host.
FROM scratch AS apk
COPY --from=build /app/dist/MatchFlix.apk /MatchFlix.apk
