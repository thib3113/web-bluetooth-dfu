# Web Bluetooth DFU (Enhanced Fork)

This repository is a fork of the original `web-bluetooth-dfu` library, specifically enhanced to provide robust support for **nRF52811** and **nRF52833** devices. It introduces a modernized build system and critical stability fixes for production environments.

### 🚀 Key Improvements

*   **Modern Build System:** Updated to **esbuild** and **TypeScript 5**, providing a streamlined development experience and better tree-shaking.
*   **Reliable Data Transfer:**
    *   **Strict CRC Validation:** Immediate termination on validation failure to prevent firmware corruption.
    *   **Packet Receipt Notifications (PRN):** Full implementation of PRN intervals (Opcode 0x02) for flow control.
*   **GATT Stability:** Integrated a **GATT Mutex** to serialize write operations, effectively eliminating "GATT operation already in progress" errors.
*   **Simplified Deployment:** Generates a standalone `dist/secure-dfu.js` bundle including all dependencies (JSZip, CRC32), ready for direct browser usage.
*   **Advanced Progress Tracking:** Events now provide granular feedback, reporting both "Sent" and "Validated" byte counts.

*Tested and verified on nRF52811 and nRF52833 using stock Nordic bootloaders.*

---

# Web Bluetooth DFU (Original Readme)

Update device firmware via Nordic's DFU protocols using [Web Bluetooth](https://webbluetoothcg.github.io/web-bluetooth/).

## Versions

Since version 12 of Nordic's SDK, the device firmware update protocol has changed to be made secure. The protocol can be seen here:

https://infocenter.nordicsemi.com/topic/com.nordic.infocenter.sdk5.v12.0.0/lib_dfu_transport_ble.html

Earlier protocols were insecure, so it is recommended to use the secure protocol version in this package.

## Features

 - Supports continuation of failed transfers and skipping of any init packet if already valid
 - Supports [Buttonless DFU](https://infocenter.nordicsemi.com/topic/com.nordic.infocenter.sdk5.v13.0.0/ble_sdk_app_buttonless_dfu.html) activation
 - Uses ES6 syntax assuming that all JS engines supporting Web Bluetooth are also ES6 compatible
 - Written with [TypeScript](https://www.typescriptlang.org/) to promote type safety

## Live Example

This repo has a live web example of the secure DFU. Open this site in a [Web Bluetooth](https://webbluetoothcg.github.io/web-bluetooth/) enabled browser:

https://thib3113.github.io/web-bluetooth-dfu/

 - Supports drag-and-drop or uploading of firmware packages
 - Supports unzipping of the firmware package in-browser
 - Supports multiple firmware images in a single package (softdevice, bootloader, application)

## Prerequisites

*   [Node.js](https://nodejs.org) v18 or newer.
*   A browser with **Web Bluetooth** support (Chrome, Edge, Opera).

## Installation

```bash
npm install @thib3113/web-bluetooth-dfu
```

## Building

If you are contributing or want to build the bundles yourself:

```bash
npm install
npm run build
```
The output will be in the `dist/` folder.

## Usage

### In the Browser (CDN / Script Tag)

You can use the standalone bundle which includes all dependencies:

```html
<script src="https://unpkg.com/@thib3113/web-bluetooth-dfu/dist/secure-dfu.js"></script>
<script>
    const dfu = new SecureDfu(); // No need to pass CRC32 anymore
    // ...
</script>
```

### In a Module System (ESM / TypeScript)

```typescript
import { SecureDfu, SecureDfuPackage } from '@thib3113/web-bluetooth-dfu';
```

## Device Configuration

You will need a [Nordic](https://www.nordicsemi.com/) [nRF51822](https://www.nordicsemi.com/eng/Products/nRF51-DK), [nRF52832](http://www.nordicsemi.com/eng/Products/Bluetooth-low-energy/nRF52-DK) or [nRF52840](http://www.nordicsemi.com/eng/Products/nRF52840-Preview-DK) development kit running the latest softdevice. Secure DFU supports softdevices from S130.

Softdevices can be found on Nordic's site:

 - [S130](http://www.nordicsemi.com/eng/Products/S130-SoftDevice) (for nRF51)
 - [S132](http://www.nordicsemi.com/eng/Products/S132-SoftDevice) (for nRF52)
 - [S140](http://www.nordicsemi.com/eng/Products/S140-SoftDevice) (for nRF52)

Upon flashing the device will be in bootloader mode and ready to receive a DFU transfer.

Example packages to update can be found in the [firmware](https://github.com/thib3113/web-bluetooth-dfu/tree/main/firmware) folder.

## Device Development

An excellent article exists with a walkthrough of using the device firmware update here:

https://devzone.nordicsemi.com/blogs/1085/getting-started-with-nordics-secure-dfu-bootloader/

tl;dr

__J-LINK Interface Firmware__
 - Ensure device is running the J-LINK interface firmware available from [Nordic](https://www.nordicsemi.com/Software-and-tools/Development-Kits/nRF52-DK)

__Download / Install__
 - Download [Nordic SDK](https://developer.nordicsemi.com/nRF5_SDK/)
 - Install [J-Link Software Package](https://www.segger.com/downloads/jlink)
 - Install [nRF5x Command Line Tools](https://www.nordicsemi.com/eng/Products/nRF52840#Downloads) (includes nrfjprog)
 - Install __nrfutil__: `$ pip install nrfutil`

__Flashing SoftDevice__
 - Erase the chip: `$ nrfjprog --family NRF52 --eraseall`
 - Grab the relevant softdevice from website (links above) or the SDK (components/softdevice/\<SoftDevice\>/hex)
 - Flash the softdevice: `$ nrfjprog --family NRF52 --program <softdevice.hex> --sectorerase --reset`

__Using Test DFU Bootloader__
 - Grab the relevant bootloader from the SDK (examples/dfu/bootloader_secure_ble/\<chip\>/hex)
 - Flash the bootloader: `$ nrfjprog --family NRF52 --program <bootloader.hex> --sectoranduicrerase --reset`

__Signing Keys__
 - Create a [signing key](https://infocenter.nordicsemi.com/topic/com.nordic.infocenter.sdk5.v13.0.0/ble_sdk_app_buttonless_dfu.html): `$ nrfutil keys generate private.key`
 - Generate the __.c__ file for the key: `$ nrfutil keys display --key pk --format code private.key --out_file dfu_public_key.c`

__Developing an Application__
 - Ensure you have a machine with relevant build tools such as `gcc`, linux is easiest
 - Rebuild the bootloader with your new key (Update the Makefile to use your new key file)
 - Flash the bootloader: `$ nrfjprog --family NRF52 --program <bootloader.hex> --sectoranduicrerase --reset`
 - Build your application using your new key file

__Building DFU Package__

Refer to this document:

https://infocenter.nordicsemi.com/topic/com.nordic.infocenter.sdk5.v13.0.0/ble_sdk_app_dfu_bootloader.html

e.g.:

    $ nrfutil pkg generate --debug-mode --application <your_app.hex> --key-file private.key dfu_app.zip