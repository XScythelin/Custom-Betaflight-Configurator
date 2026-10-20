![Betaflight](https://raw.githubusercontent.com/betaflight/.github/main/profile/images/bf_logo.svg#gh-light-mode-only)
![Betaflight](https://raw.githubusercontent.com/betaflight/.github/main/profile/images/bf_logo_dark.svg#gh-dark-mode-only)

# Custom Betaflight Configurator

Пользовательская версия на базе стабильного Betaflight Configurator **2026.6.2**:
быстрая прошивка локального HEX и загрузка дампа с проверкой сохранённых настроек.

**Запуск на Windows:** полностью распакуйте готовый переносимый архив и откройте
`Запустить.cmd`. Нужен Chrome или Edge. Установка Node.js и npm не требуется,
если в архив включены `.runtime/node` и готовая сборка `src/dist`.

**GitHub → Code → Download ZIP содержит исходники, а не готовую переносимую сборку.**
Подробности запуска, сборки и состава переносимого архива:
[ЛОКАЛЬНЫЙ-ЗАПУСК.md](ЛОКАЛЬНЫЙ-ЗАПУСК.md).

## Установка и сборка без готового архива (Windows x64)

### 1. Установите необходимые программы

- [Node.js **24.x**](https://nodejs.org/download/release/latest-v24.x/) — выберите
  установщик Windows x64 (`.msi`). npm входит в комплект; оставьте включённым
  добавление Node.js в `PATH`.
- [Git for Windows](https://git-scm.com/downloads/win) — нужен не только для
  клонирования, но и для установки одной из зависимостей с GitHub.
  При установке разрешите использование Git из командной строки.
- Google Chrome или Microsoft Edge — для запуска интерфейса и доступа к USB/COM.

После установки откройте **новое окно PowerShell** и проверьте:

```powershell
node --version
npm.cmd --version
git --version
```

Версия Node.js должна начинаться с `v24.`. Интернет нужен для скачивания исходников
и зависимостей. Python, Rust, Android Studio и сборка Tauri для этого способа
запуска не требуются.

### 2. Скачайте исходники

В PowerShell перейдите в папку, где хотите разместить проект, и выполните:

```powershell
git clone --branch main https://github.com/XScythelin/Custom-Betaflight-Configurator.git
cd Custom-Betaflight-Configurator
```

Либо скачайте **Code → Download ZIP**, полностью распакуйте его, откройте
полученную папку в Проводнике и выберите **«Открыть в терминале»**.
Команды следующего шага нужно выполнять в папке с `package.json`.

### 3. Установите зависимости и соберите приложение

Выполняйте команды по очереди. Переходите к следующей только после успешного
завершения предыдущей:

```powershell
npm.cmd ci
npm.cmd run build
```

Первая команда скачивает зависимости в `node_modules`, вторая создаёт готовое
приложение в `src/dist`. Используем `npm.cmd`, чтобы политика PowerShell для
скриптов `npm.ps1` не мешала запуску. Если первая команда сообщает об отсутствии
Git или Node.js, проверьте установки и заново откройте терминал.

### 4. Запустите

Дважды нажмите **`Запустить.cmd`** в папке проекта или выполните:

```powershell
.\Запустить.cmd
```

Запускной файл использует установленный Node.js 24, если переносимого
`.runtime/node/node.exe` нет. Откроется отдельное окно Chrome или Edge
с адресом `http://127.0.0.1:8080`. Открывать `src/dist/index.html` напрямую нельзя.
Подключите полётник и при запросе разрешите браузеру доступ к COM-порту или DFU.
Если Windows не распознаёт устройство, может понадобиться соответствующий USB-драйвер.

После изменения исходников снова выполните `npm.cmd run build`.
После обновления зависимостей сначала повторите `npm.cmd ci`.
Для передачи на ПК **без установленного Node.js** дополнительно нужен переносимый
Node.js в `.runtime/node`; состав архива описан в
[ЛОКАЛЬНЫЙ-ЗАПУСК.md](ЛОКАЛЬНЫЙ-ЗАПУСК.md).

---

Ниже сохранена документация исходного проекта Betaflight.

## Betaflight App

[![Latest version](https://img.shields.io/github/v/release/betaflight/betaflight-configurator)](https://github.com/betaflight/betaflight-configurator/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/betaflight/betaflight-configurator/deploy.yml?branch=master)](https://github.com/betaflight/betaflight-configurator/actions/workflows/deploy.yml)
[![Crowdin](https://d322cqt584bo4o.cloudfront.net/betaflight-configurator/localized.svg)](https://crowdin.com/project/betaflight-configurator)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=betaflight_betaflight-configurator&metric=alert_status)](https://sonarcloud.io/dashboard?id=betaflight_betaflight-configurator)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Join us on Discord!](https://img.shields.io/discord/868013470023548938)](https://discord.gg/n4E6ak4u3c)


Betaflight App is a crossplatform configuration and management application for the Betaflight flight control system.

The Betaflight App is a Progressive Web Application (PWA). The most recent release of the Betaflight App is available at [app.betaflight.com](https://app.betaflight.com)

NOTE: If you are considering testing the latest unstable release then it is at [master.app.betaflight.com](https://master.app.betaflight.com)

Various types of aircraft are supported by the tool and by Betaflight, e.g. quadcopters, hexacopters, octocopters and fixed-wing aircraft.

## Historical Releases

These are still available under different operating systems and allows you to configure the Betaflight software running on any supported Betaflight target. [Downloads are available in Releases.](https://github.com/betaflight/betaflight-configurator/releases)

## Installation

### Standalone

We provide a standalone program for Windows, Linux, Mac and Android.

Download the installer from [Releases.](https://github.com/betaflight/betaflight-configurator/releases)

### Notes

#### Windows users

The minimum required version of windows is Windows 8.

#### MacOS X users

Changes to the security model used in the latest versions of MacOS X 10.14 (Mojave) and 10.15 (Catalina) mean that the operating system will show an error message ('"Betaflight Configurator.app" is damaged and can’t be opened. You should move it to the Trash.') when trying to install the application. To work around this, run the following command in a terminal after installing: `sudo xattr -rd com.apple.quarantine /Applications/Betaflight\ App.app`.

#### Linux users

First step is to download the installer and keep it in your working directory, which can be done with the following command:
```
wget https://github.com/betaflight/betaflight-configurator/releases/download/10.10.0/betaflight-configurator_10.10.0_amd64.deb
```

In most Linux distributions your user won't have access to serial interfaces by default. To add this access right type the following command in a terminal, log out your user and log in again:

```
sudo usermod -aG dialout ${USER}
```

Post-installation errors can be prevented by making sure the directory `/usr/share/desktop-directories` exists. To make sure it exists, run the following command before installing the package:

```
sudo mkdir /usr/share/desktop-directories/
```

The `libatomic` library must also be installed before installing Betaflight App. (If the library is missing, the installation will succeed but Betaflight App will not start.) Some Linux distributions (e.g. Fedora) will install it automatically. On Debian or Ubuntu you can install it as follows:

```
sudo apt install libatomic1
```

On Ubuntu 23.10 please follow these alternative steps for installation:

```
sudo echo "deb http://archive.ubuntu.com/ubuntu/ lunar universe" > /etc/apt/sources.list.d/lunar-repos-old.list
sudo apt update
sudo dpkg -i betaflight-configurator_10.10.0_amd64.deb
sudo apt-get -f install
```

On Ubuntu 24.10 and above, please follow these steps, as some deprecated modules are no longer available through apt on this distro:
```
sudo apt update
wget http://archive.ubuntu.com/ubuntu/pool/universe/g/gconf/libgconf-2-4_3.2.6-4ubuntu1_amd64.deb
wget http://archive.ubuntu.com/ubuntu/pool/universe/g/gconf/gconf2-common_3.2.6-4ubuntu1_all.deb
sudo dpkg -i gconf2-common_3.2.6-4ubuntu1_all.deb
sudo dpkg -i libgconf-2-4_3.2.6-4ubuntu1_amd64.deb
sudo dpkg -i betaflight-configurator_10.10.0_amd64.deb
sudo apt-get -f install
```

#### Graphics Issues

If you experience graphics display problems or smudged/dithered fonts display issues in Betaflight App, try invoking the `betaflight-configurator` executable file with the `--disable-gpu` command line switch. This will switch off hardware graphics acceleration. Likewise, setting your graphics card antialiasing option to OFF (e.g. FXAA parameter on NVidia graphics cards) might be a remedy as well.

### Unstable Testing Versions

The future of the Betaflight App is moving to a PWA (Progressive Web Application). In this way it will be easier to maintain specially to support different devices like phones, tablets. etc. Is a work in progress but you can have access to the latest snapshot in PWA way without installing anything (take into account that some things don't work and are in development).

- Latest PWA master snapshot of the App: [https://master.app.betaflight.com/](https://master.app.betaflight.com/)

**Be aware that this version is intended for testing / feedback only, and may be buggy or broken, and can cause flight controller settings to be corrupted. Caution is advised when using this version.**

## Languages

**Please do not submit pull requests for translation changes, but read and follow the instructions below!**

Betaflight App has been translated into several languages. The application will try to detect and use your system language if a translation into this language is available. You can help [translating the application into your language](https://github.com/betaflight/betaflight/tree/master/README.md#translators);

If you prefer to have the application in English or any other language, you can select your desired language in the first screen of the application.

## Build and Development

### Technical details

The next versions of the App will be a modern tool that based on PWA (Progressive Web Application) and uses principally Node, npm, Vite and Vue for development and building. For Android we use Capacitor as wrapper over the PWA. To build and develop over it, follow the instructions below.

### Prepare your environment

1. Install [node.js](https://nodejs.org/) (refer to [.nvmrc](./.nvmrc) for minimum required version)

### PWA version

#### Run development version

1. Change to project folder and run `npm install`.
2. Run `npm run dev`.

The web app will be available at http://localhost:8080 with full HMR.

#### Run production version

1. Change to project folder and run `npm install`.
2. Run `npm run build`.
3. Run `npm run preview` after build has finished.

Alternatively you can run `npm run review` to build and preview in one step.

The web app should behave directly as in production, available at http://localhost:8080.

### Android version

The Android version uses Capacitor as the native wrapper with custom plugins to bridge the PWA to native capabilities.

#### Prerequisites

You need to install [Android Studio](https://developer.android.com/studio) as Capacitor apps are configured and managed through it.

#### Run development version

1. Change to project folder and run `npm install`.
2. Run `npm run android:run`.

The command will ask for the device to run the app. You need to have some Android virtual machine created or some Android phone [connected using ADB](https://developer.android.com/tools/adb).

As alternative to the step 2, you can execute a `npm run android:open` to open de project into Android Studio and run or debug the app from there.

#### Run development version with live reload

1. Change to project folder and run `npm install`.
2. Run `npm run dev -- --host`. It will start the vite server and will show you the IP address where the server is listening.
3. Run `npm run android:dev`

This will ask for the IP where the server is running (if there are more than one network interfaces). You need to have some Android virtual machine created or some Android phone [connected using ADB](https://developer.android.com/tools/adb).
Any change make in the code will reload the app in the Android device.

### Running tests

`npm test`

## Support and Developers Channel

There's a dedicated Discord server here:

https://discord.gg/n4E6ak4u3c

We also have a Facebook Group. Join us to get a place to talk about Betaflight, ask configuration questions, or just hang out with fellow pilots.

https://www.facebook.com/groups/betaflightgroup/

Etiquette: Don't ask to ask and please wait around long enough for a reply - sometimes people are out flying, asleep or at work and can't answer immediately.

### Issue trackers

For Betaflight App issues raise them here

https://github.com/betaflight/betaflight-configurator/issues

For Betaflight Firmware issues raise them here

https://github.com/betaflight/betaflight/issues

## Developers

We accept clean and reasonable patches, submit them!

## Credits

For the full details of the contributions made to the Betaflight App (and its predecessors) please check out the [Github contributors page](https://github.com/betaflight/betaflight-configurator/graphs/contributors).
