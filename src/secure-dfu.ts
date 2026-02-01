/*
* Web Bluetooth DFU
* Copyright (c) 2018 Rob Moran
*
* The MIT License (MIT)
*/

import { EventDispatcher } from "./dispatcher";
import * as CRC32 from "crc-32";

const CONTROL_UUID = "8ec90001-f315-4f60-9fb8-838830daea50";
const PACKET_UUID = "8ec90002-f315-4f60-9fb8-838830daea50";
const BUTTON_UUID = "8ec90003-f315-4f60-9fb8-838830daea50";

const LITTLE_ENDIAN = true;

const OPERATIONS = {
    BUTTON_COMMAND:         [ 0x01 ],
    CREATE_COMMAND:         [ 0x01, 0x01 ],
    CREATE_DATA:            [ 0x01, 0x02 ],
    RECEIPT_NOTIFICATIONS:  [ 0x02 ],
    CACULATE_CHECKSUM:      [ 0x03 ],
    EXECUTE:                [ 0x04 ],
    SELECT_COMMAND:         [ 0x06, 0x01 ],
    SELECT_DATA:            [ 0x06, 0x02 ],
    RESPONSE:               [ 0x60, 0x20 ]
};

const RESPONSE = {
    0x00: "Invalid opcode",
    0x01: "Operation successful",
    0x02: "Opcode not supported",
    0x03: "Missing or invalid parameter value",
    0x04: "Not enough memory for the data object",
    0x05: "Data object does not match requirements",
    0x07: "Not a valid object type for a Create request",
    0x08: "Operation not permitted (Wrong state)",
    0x0A: "Operation failed",
    0x0B: "Extended error"
};

const EXTENDED_ERROR = {
    0x00: "No extended error",
    0x01: "Invalid error code",
    0x02: "Wrong command format",
    0x03: "Unknown command",
    0x04: "Init command invalid",
    0x05: "Firmware version failure (Downgrade blocked)",
    0x06: "Hardware version failure",
    0x07: "Softdevice version failure",
    0x08: "Signature missing",
    0x09: "Wrong hash type",
    0x0A: "Hash failed",
    0x0B: "Wrong signature type",
    0x0C: "Verification failed (CRC mismatch)",
    0x0D: "Insufficient space"
};

export interface BluetoothLEScanFilterInit {
    services?: Array<string | number>;
    name?: string;
    namePrefix?: string;
}

export interface UuidOptions {
    service?: number | string;
    button?: number | string;
    control?: number | string;
    packet?: number | string;
}

export type SmartSpeedConfig = boolean | ((error: string, prn: number, packetSize: number) => { prn: number, packetSize: number } | null);

export class SecureDfu extends EventDispatcher {
    public static SERVICE_UUID: number = 0xFE59;
    public static EVENT_LOG: string = "log";
    public static EVENT_PROGRESS: string = "progress";

    private DEFAULT_UUIDS: UuidOptions = {
        service: SecureDfu.SERVICE_UUID,
        button: BUTTON_UUID,
        control: CONTROL_UUID,
        packet: PACKET_UUID
    };

    private notifyFns: {} = {};
    private controlChar: BluetoothRemoteGATTCharacteristic = null;
    private packetChar: BluetoothRemoteGATTCharacteristic = null;
    private writeQueue: Promise<any> = Promise.resolve();

    /**
     * Packet size for data transfer. Default to 20 for maximum compatibility.
     * Can be increased (e.g., 100) for better performance on modern devices.
     */
    public packetSize: number = 100;

    /**
     * PRN interval. Set to 15-20 for good speed.
     */
    public packetReceiptNotification: number = 0;

    /**
     * If true, always starts transfer from byte 0, ignoring device cache.
     * Default to true for Boks stability.
     */
    public forceRestart: boolean = true;

    /**
     * Smart Speed Degradation.
     * If enabled, the library will automatically reduce PRN and/or packetSize
     * when errors occur, and retry the transfer.
     */
    public enableSmartSpeed: SmartSpeedConfig = false;

    private retriesAtCurrentSpeed: number = 0;
    private totalBytes: number = 0;
    private sentBytes: number = 0;
    private validatedBytes: number = 0;
    private packetsSentSincePRN: number = 0;
    private prnResolver: () => void = null;
    private currentObjectType: string = "unknown";

    private crc32Impl: (data: Array<number> | Uint8Array, seed?: number) => number;

    constructor(
        crc32?: (data: Array<number> | Uint8Array, seed?: number) => number,
        private bluetooth?: Bluetooth,
        private delay: number = 0
    ) {
        super();
        // Use provided CRC32 or fallback to internal library
        this.crc32Impl = crc32 || CRC32.buf;

        if (!this.bluetooth && window && window.navigator && window.navigator.bluetooth) {
            this.bluetooth = navigator.bluetooth;
        }
    }

    private log(message: string) {
        this.dispatchEvent(SecureDfu.EVENT_LOG, { message: message });
    }

    private emitProgress() {
        this.dispatchEvent(SecureDfu.EVENT_PROGRESS, {
            object: this.currentObjectType,
            totalBytes: this.totalBytes || 1,
            sentBytes: this.sentBytes,
            validatedBytes: this.validatedBytes
        });
    }

    private async queuedWrite(char: BluetoothRemoteGATTCharacteristic, value: BufferSource): Promise<void> {
        this.writeQueue = this.writeQueue.then(async () => {
            let attempts = 15;
            while (attempts > 0) {
                try {
                    await char.writeValue(value);
                    return;
                } catch (e) {
                    if (e.message.includes("in progress")) {
                        attempts--;
                        await new Promise(r => setTimeout(r, 150));
                    } else {
                        throw e;
                    }
                }
            }
            throw new Error("GATT write failed (Device Busy)");
        });
        return this.writeQueue;
    }

    private connect(device: BluetoothDevice): Promise<BluetoothDevice> {
        device.addEventListener("gattserverdisconnected", () => {
            this.notifyFns = {};
            this.controlChar = null;
            this.packetChar = null;
            this.writeQueue = Promise.resolve();
        }, false);

        return this.gattConnect(device)
        .then(characteristics => {
            this.packetChar = characteristics.find(c => c.uuid === PACKET_UUID);
            this.controlChar = characteristics.find(c => c.uuid === CONTROL_UUID);
            if (!this.packetChar || !this.controlChar) throw new Error("Missing DFU characteristics");

            return this.controlChar.startNotifications();
        })
        .then(() => {
            this.controlChar.addEventListener("characteristicvaluechanged", this.handleNotification.bind(this), false);
            this.log("enabled control notifications");

            if (this.packetReceiptNotification > 0) {
                const view = new DataView(new ArrayBuffer(2));
                view.setUint16(0, this.packetReceiptNotification, LITTLE_ENDIAN);
                this.log(`enabling PRNs (interval: ${this.packetReceiptNotification})`);
                return this.sendControl(OPERATIONS.RECEIPT_NOTIFICATIONS, view.buffer);
            }
        })
        .then(() => device);
    }

    private gattConnect(device: BluetoothDevice, serviceUUID: number | string = SecureDfu.SERVICE_UUID): Promise<Array<BluetoothRemoteGATTCharacteristic>> {
        return Promise.resolve()
        .then(() => device.gatt.connected ? device.gatt : device.gatt.connect())
        .then(server => {
            this.log("connected to gatt server");
            return server.getPrimaryService(serviceUUID).catch(() => { throw new Error("Unable to find DFU service"); });
        })
        .then(service => service.getCharacteristics());
    }

    private handleNotification(event: any) {
        const view = event.target.value;

        if (view.getUint8(0) === 0x03) {
            this.validatedBytes = view.getUint32(1, LITTLE_ENDIAN);
            this.emitProgress();
            if (this.prnResolver) {
                const resolve = this.prnResolver;
                this.prnResolver = null;
                resolve();
            }
            return;
        }

        if (OPERATIONS.RESPONSE.indexOf(view.getUint8(0)) < 0) {
            throw new Error("Unrecognised control response");
        }

        const operation = view.getUint8(1);
        if (this.notifyFns[operation]) {
            const result = view.getUint8(2);
            let error = null;

            if (result === 0x01) {
                this.notifyFns[operation].resolve(new DataView(view.buffer, 3));
            } else {
                const msg = (result === 0x0B) ? EXTENDED_ERROR[view.getUint8(3)] : RESPONSE[result];
                error = `Error 0x${result.toString(16)}: ${msg}`;
            }

            if (error) {
                this.log(error);
                this.notifyFns[operation].reject(error);
            }
            delete this.notifyFns[operation];
        }
    }

    private async sendOperation(characteristic: BluetoothRemoteGATTCharacteristic, operation: Array<number>, buffer?: ArrayBuffer): Promise<DataView> {
        let size = operation.length;
        if (buffer) size += buffer.byteLength;
        const value = new Uint8Array(size);
        value.set(operation);
        if (buffer) value.set(new Uint8Array(buffer), operation.length);

        return new Promise(async (resolve, reject) => {
            this.notifyFns[operation[0]] = { resolve, reject };
            try {
                await this.queuedWrite(characteristic, value);
            } catch (e) {
                delete this.notifyFns[operation[0]];
                reject(e);
            }
        });
    }

    private sendControl(operation: Array<number>, buffer?: ArrayBuffer): Promise<DataView> {
        return this.sendOperation(this.controlChar, operation, buffer)
            .then(resp => new Promise(resolve => setTimeout(() => resolve(resp), this.delay)));
    }

    private transfer(buffer: ArrayBuffer, type: string, selectType: Array<number>, createType: Array<number>): Promise<void> {
        return this.sendControl(selectType).then(response => {
            const maxSize = response.getUint32(0, LITTLE_ENDIAN);
            let offset = response.getUint32(4, LITTLE_ENDIAN);
            const crc = response.getInt32(8, LITTLE_ENDIAN);

            if (this.forceRestart && offset > 0) {
                this.log(`Restarting: Clearing ${offset} existing bytes.`);
                offset = 0;
            } else if (type === "init" && offset === buffer.byteLength && this.checkCrc(buffer, crc)) {
                this.log("init packet already available, skipping transfer");
                return;
            } else if (offset === 0) {
                this.log(`Starting fresh transfer (offset 0).`);
            }

            this.currentObjectType = type;
            this.totalBytes = buffer.byteLength;
            this.sentBytes = offset;
            this.validatedBytes = offset;
            this.packetsSentSincePRN = 0;
            this.emitProgress();

            return this.transferObject(buffer, createType, maxSize, offset);
        });
    }

    private transferObject(buffer: ArrayBuffer, createType: Array<number>, maxSize: number, offset: number): Promise<void> {
        const start = offset - offset % maxSize;
        const end = Math.min(start + maxSize, buffer.byteLength);
        const view = new DataView(new ArrayBuffer(4));
        view.setUint32(0, end - start, LITTLE_ENDIAN);

        return this.sendControl(createType, view.buffer)
        .then(() => this.transferData(buffer.slice(start, end), start))
        .then(() => this.sendControl(OPERATIONS.CACULATE_CHECKSUM))
        .then(response => {
            const crc = response.getInt32(4, LITTLE_ENDIAN);
            const transferred = response.getUint32(0, LITTLE_ENDIAN);
            if (this.checkCrc(buffer.slice(0, transferred), crc)) {
                this.log(`written ${transferred} bytes`);
                this.validatedBytes = transferred;
                this.emitProgress();
                return this.sendControl(OPERATIONS.EXECUTE);
            } else {
                throw new Error(`CRC fail at ${transferred}`);
            }
        })
        .then(() => {
            if (end < buffer.byteLength) {
                return this.transferObject(buffer, createType, maxSize, end);
            }
            this.log("transfer complete");
            this.retriesAtCurrentSpeed = 0;
        })
        .catch(async (error) => {
            if (this.calculateSmartSpeed(error.message)) {
                // Reset write queue to allow new operations
                this.writeQueue = Promise.resolve();

                if (this.packetReceiptNotification > 0) {
                    const view = new DataView(new ArrayBuffer(2));
                    view.setUint16(0, this.packetReceiptNotification, LITTLE_ENDIAN);
                    await this.sendControl(OPERATIONS.RECEIPT_NOTIFICATIONS, view.buffer);
                }
                this.packetsSentSincePRN = 0;
                return this.transferObject(buffer, createType, maxSize, offset);
            }
            throw error;
        });
    }

    private async transferData(data: ArrayBuffer, offset: number, start: number = 0) {
        const end = Math.min(start + this.packetSize, data.byteLength);
        const packet = data.slice(start, end);

        if (this.packetReceiptNotification > 0 && this.packetsSentSincePRN >= this.packetReceiptNotification) {
            await new Promise<void>(resolve => {
                this.prnResolver = resolve;
                setTimeout(() => { if (this.prnResolver) { this.prnResolver = null; resolve(); } }, 3000);
            });
            this.packetsSentSincePRN = 0;
        }

        await this.queuedWrite(this.packetChar, packet);
        this.packetsSentSincePRN++;
        
        if (this.delay > 0) await new Promise(r => setTimeout(r, this.delay));
        
        this.sentBytes = offset + end;
        this.emitProgress();
        
        if (end < data.byteLength) {
            return this.transferData(data, offset, end);
        }
    }

    private checkCrc(buffer: ArrayBuffer, crc: number): boolean {
        return crc === this.crc32Impl(new Uint8Array(buffer));
    }

    private calculateSmartSpeed(error: string): boolean {
        if (!this.enableSmartSpeed) return false;

        this.retriesAtCurrentSpeed++;

        // Retry 3 times at current speed before degrading
        if (this.retriesAtCurrentSpeed <= 3) {
            this.log(`Smart Speed: Retrying with same parameters (Attempt ${this.retriesAtCurrentSpeed}/3)`);
            return true;
        }

        this.retriesAtCurrentSpeed = 0;
        let newPrn = this.packetReceiptNotification;
        let newSize = this.packetSize;
        let changed = false;

        if (typeof this.enableSmartSpeed === "function") {
            const result = this.enableSmartSpeed(error, newPrn, newSize);
            if (result) {
                newPrn = result.prn;
                newSize = result.packetSize;
                changed = true;
            }
        } else {
            // Default Strategy
            if (newSize > 20) {
                newSize = Math.max(20, Math.ceil(newSize / 2));
                changed = true;
            } else if (newPrn > 1) {
                newPrn = Math.ceil(newPrn / 2);
                changed = true;
            } else if (newPrn === 0) {
                // If PRN was disabled (0), enable it safely
                newPrn = 12;
                changed = true;
            }
        }

        if (changed) {
            this.log(`Smart Speed: Degrading parameters. PRN: ${this.packetReceiptNotification}->${newPrn}, MTU: ${this.packetSize}->${newSize}`);
            this.packetReceiptNotification = newPrn;
            this.packetSize = newSize;
            return true;
        }
        return false;
    }

    public requestDevice(buttonLess: boolean, filters: any, uuids: UuidOptions = this.DEFAULT_UUIDS): Promise<BluetoothDevice> {
        uuids = { ...this.DEFAULT_UUIDS, ...uuids };
        const options: any = { optionalServices: [ uuids.service ] };
        if (filters) options.filters = filters; else options.acceptAllDevices = true;
        return this.bluetooth.requestDevice(options).then(device => buttonLess ? this.setDfuMode(device, uuids) : device);
    }

    public setDfuMode(device: BluetoothDevice, uuids: UuidOptions = this.DEFAULT_UUIDS): Promise<BluetoothDevice> {
        uuids = { ...this.DEFAULT_UUIDS, ...uuids };
        return this.gattConnect(device, uuids.service).then(characteristics => {
            const buttonChar = characteristics.find(c => c.uuid === uuids.button);
            if (!buttonChar) return (characteristics.find(c => c.uuid === uuids.control) && characteristics.find(c => c.uuid === uuids.packet)) ? device : Promise.reject("Unsupported");
            return new Promise<BluetoothDevice>(resolve => {
                const complete = () => { this.notifyFns = {}; resolve(null); };
                buttonChar.startNotifications().then(() => {
                    device.addEventListener("gattserverdisconnected", complete, false);
                    buttonChar.addEventListener("characteristicvaluechanged", this.handleNotification.bind(this), false);
                    return this.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND);
                }).then(() => complete());
            });
        });
    }

    public update(device: BluetoothDevice, init: ArrayBuffer, firmware: ArrayBuffer): Promise<BluetoothDevice> {
        this.retriesAtCurrentSpeed = 0;
        return this.connect(device)
            .then(() => this.transfer(init, "init", OPERATIONS.SELECT_COMMAND, OPERATIONS.CREATE_COMMAND))
            .then(() => new Promise(r => setTimeout(r, 500))) // Wait after init
            .then(() => this.transfer(firmware, "firmware", OPERATIONS.SELECT_DATA, OPERATIONS.CREATE_DATA))
            .then(() => {
                this.log("disconnecting...");
                return new Promise(resolve => {
                    const t = setTimeout(() => resolve(device), 5000);
                    device.addEventListener("gattserverdisconnected", () => { clearTimeout(t); resolve(device); }, false);
                    device.gatt.disconnect();
                });
            });
    }
}