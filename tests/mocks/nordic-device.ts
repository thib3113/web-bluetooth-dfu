import { MockBluetoothDevice, MockBluetoothRemoteGATTCharacteristic, MockBluetoothRemoteGATTService } from './web-bluetooth';
import * as CRC32 from 'crc-32';

const SERVICE_UUID = 0xFE59;
const CONTROL_UUID = "8ec90001-f315-4f60-9fb8-838830daea50";
const PACKET_UUID = "8ec90002-f315-4f60-9fb8-838830daea50";

const OPCODES = {
    CREATE: 0x01,
    SET_PRN: 0x02,
    CALCULATE_CHECKSUM: 0x03,
    EXECUTE: 0x04,
    SELECT: 0x06,
    RESPONSE: 0x60,
};

const RESULT = {
    SUCCESS: 0x01,
    OPCODE_NOT_SUPPORTED: 0x02,
    INVALID_PARAMETER: 0x03,
    INSUFFICIENT_RESOURCES: 0x04,
    INVALID_OBJECT: 0x05,
    UNSUPPORTED_TYPE: 0x07,
    OPERATION_NOT_PERMITTED: 0x08,
    OPERATION_FAILED: 0x0A,
    EXTENDED_ERROR: 0x0B,
};

export const EXTENDED_ERRORS = {
    FIRMWARE_VERSION_FAILURE: 0x05,
    INSUFFICIENT_SPACE: 0x0D,
    VERIFICATION_FAILED: 0x0C,
};

export interface DfuConfig {
    maxObjectSize: number; // e.g., 4096
    mtu: number; // Max Transfer Unit (payload size for writes)
    flakiness: number; // 0 to 1, probability of write error
    writeDelay: number; // ms
    // Forced errors for testing
    forceExtendedError?: {
        opCode: number;
        code: number;
    } | null;
    forceCrcMismatch?: boolean;
}

export class NordicDfuDevice {
    public device: MockBluetoothDevice;
    private service: MockBluetoothRemoteGATTService;
    private controlChar: MockBluetoothRemoteGATTCharacteristic;
    private packetChar: MockBluetoothRemoteGATTCharacteristic;

    private config: DfuConfig;

    // State
    private prnInterval: number = 0;
    private packetsReceivedSincePrn: number = 0;
    private currentObject: {
        type: number; // 1 = Command/Init, 2 = Data/Firmware
        maxSize: number;
        offset: number;
        crc: number;
        data: Uint8Array;
    } | null = null;

    // We simulate "Flash" storage where validated objects go
    public flashStorage: {
        initPacket: Uint8Array | null;
        firmware: Uint8Array | null;
    } = { initPacket: null, firmware: null };

    constructor(config: Partial<DfuConfig> = {}) {
        this.config = {
            maxObjectSize: 4096,
            mtu: 512, // Default to a safe high value if not specified
            flakiness: 0,
            writeDelay: 0,
            forceExtendedError: null,
            forceCrcMismatch: false,
            ...config
        };

        this.device = new MockBluetoothDevice("mock-device-id", "Nordic DFU Mock");
        const gattServer = this.device.gatt!;
        this.service = gattServer.addService(SERVICE_UUID.toString()); // Simple string match for mock

        this.controlChar = this.service.addCharacteristic(CONTROL_UUID, {
            notify: true,
            write: true
        });

        this.packetChar = this.service.addCharacteristic(PACKET_UUID, {
            writeWithoutResponse: true,
            write: true
        });

        // Hook into writes
        const originalControlWrite = this.controlChar.writeValue.bind(this.controlChar);
        this.controlChar.writeValue = async (val) => {
            await this.simulateDelayAndError();
            await originalControlWrite(val);
            this.handleControlWrite(val);
        };

        const originalPacketWrite = this.packetChar.writeValue.bind(this.packetChar);
        this.packetChar.writeValue = async (val) => {
            await this.simulateDelayAndError();
            await originalPacketWrite(val);
            this.handlePacketWrite(val);
        };
    }

    public setConfig(config: Partial<DfuConfig>) {
        this.config = { ...this.config, ...config };
    }

    private async simulateDelayAndError() {
        if (this.config.writeDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.config.writeDelay));
        }
        if (this.config.flakiness > 0 && Math.random() < this.config.flakiness) {
            // Throw "in progress" to trigger library retry logic
            throw new Error("GATT operation in progress");
        }
    }

    private sendResponse(opcode: number, result: number, payload: number[] = []) {
        const buffer = new ArrayBuffer(3 + payload.length);
        const view = new DataView(buffer);
        view.setUint8(0, OPCODES.RESPONSE);
        view.setUint8(1, opcode);
        view.setUint8(2, result);
        payload.forEach((byte, i) => view.setUint8(3 + i, byte));

        // Update value (not strictly necessary for notify but good for state)
        this.controlChar.value = view;

        // Dispatch event
        const event = new Event('characteristicvaluechanged');
        Object.defineProperty(event, 'target', { value: { value: view } });
        this.controlChar.dispatchEvent(event);
    }

    private handleControlWrite(value: BufferSource) {
        let data: DataView;
        if (value instanceof DataView) data = value;
        else if (value instanceof ArrayBuffer) data = new DataView(value);
        else data = new DataView(value.buffer);

        const opcode = data.getUint8(0);

        // Check for forced errors
        if (this.config.forceExtendedError && this.config.forceExtendedError.opCode === opcode) {
            this.sendResponse(opcode, RESULT.EXTENDED_ERROR, [this.config.forceExtendedError.code]);
            return;
        }

        switch (opcode) {
            case OPCODES.SELECT: {
                const type = data.getUint8(1);

                let maxSize = this.config.maxObjectSize;
                let offset = 0;
                let crc = 0;

                if (this.currentObject && this.currentObject.type === type) {
                    offset = this.currentObject.offset;
                    crc = this.currentObject.crc;
                }

                const responsePayload = new Uint8Array(12);
                const view = new DataView(responsePayload.buffer);
                view.setUint32(0, maxSize, true); // Little Endian
                view.setUint32(4, offset, true);
                view.setInt32(8, crc, true);

                this.sendResponse(OPCODES.SELECT, RESULT.SUCCESS, Array.from(responsePayload));
                break;
            }

            case OPCODES.CREATE: {
                const type = data.getUint8(1);
                const size = data.getUint32(2, true);

                if (type !== 0x01 && type !== 0x02) {
                    this.sendResponse(OPCODES.CREATE, RESULT.UNSUPPORTED_TYPE);
                    return;
                }

                // Enforce Max Object Size
                if (size > this.config.maxObjectSize) {
                    this.sendResponse(OPCODES.CREATE, RESULT.INSUFFICIENT_RESOURCES);
                    return;
                }

                this.currentObject = {
                    type,
                    maxSize: size,
                    offset: 0,
                    crc: 0,
                    data: new Uint8Array(0)
                };

                this.sendResponse(OPCODES.CREATE, RESULT.SUCCESS);
                break;
            }

            case OPCODES.SET_PRN: {
                const prn = data.getUint16(1, true);
                this.prnInterval = prn;
                this.packetsReceivedSincePrn = 0;
                this.sendResponse(OPCODES.SET_PRN, RESULT.SUCCESS);
                break;
            }

            case OPCODES.CALCULATE_CHECKSUM: {
                if (!this.currentObject) {
                    this.sendResponse(OPCODES.CALCULATE_CHECKSUM, RESULT.OPERATION_FAILED);
                    return;
                }
                const responsePayload = new Uint8Array(8);
                const view = new DataView(responsePayload.buffer);
                view.setUint32(0, this.currentObject.offset, true);

                let crc = this.currentObject.crc;
                if (this.config.forceCrcMismatch) {
                    crc = ~crc; // Invert to ensure mismatch
                }
                view.setInt32(4, crc, true);

                this.sendResponse(OPCODES.CALCULATE_CHECKSUM, RESULT.SUCCESS, Array.from(responsePayload));
                break;
            }

            case OPCODES.EXECUTE: {
                if (!this.currentObject) {
                    this.sendResponse(OPCODES.EXECUTE, RESULT.OPERATION_FAILED);
                    return;
                }

                // "Persist" to flash
                if (this.currentObject.type === 0x01) {
                    this.flashStorage.initPacket = this.currentObject.data;
                } else {
                    // Append to firmware
                    if (!this.flashStorage.firmware) {
                        this.flashStorage.firmware = this.currentObject.data;
                    } else {
                        const newFw = new Uint8Array(this.flashStorage.firmware.length + this.currentObject.data.length);
                        newFw.set(this.flashStorage.firmware);
                        newFw.set(this.currentObject.data, this.flashStorage.firmware.length);
                        this.flashStorage.firmware = newFw;
                    }
                }

                // Clear current object (ready for next block)
                this.currentObject = null;
                this.sendResponse(OPCODES.EXECUTE, RESULT.SUCCESS);
                break;
            }

            default:
                this.sendResponse(opcode, RESULT.OPCODE_NOT_SUPPORTED);
        }
    }

    private handlePacketWrite(value: BufferSource) {
        if (!this.currentObject) {
            return;
        }

        let u8: Uint8Array;
        if (value instanceof DataView) u8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        else if (value instanceof ArrayBuffer) u8 = new Uint8Array(value);
        else u8 = value as Uint8Array;

        // Enforce MTU
        if (u8.length > this.config.mtu) {
            // Throwing error as if the stack rejected it
            throw new Error(`Value is longer than maximum length (${this.config.mtu})`);
        }

        // Append Data
        const newData = new Uint8Array(this.currentObject.data.length + u8.length);
        newData.set(this.currentObject.data);
        newData.set(u8, this.currentObject.data.length);
        this.currentObject.data = newData;

        this.currentObject.offset += u8.length;
        this.currentObject.crc = CRC32.buf(this.currentObject.data);

        this.packetsReceivedSincePrn++;

        if (this.prnInterval > 0 && this.packetsReceivedSincePrn >= this.prnInterval) {
            // Delay notification to avoid race condition in tests/library where
            // the library hasn't set up the listener promise yet.
            setTimeout(() => this.sendChecksumNotification(), 10);
            this.packetsReceivedSincePrn = 0;
        }
    }

    private sendChecksumNotification() {
        if (!this.currentObject) return;

        const responsePayload = new Uint8Array(9);
        const view = new DataView(responsePayload.buffer);
        view.setUint8(0, OPCODES.CALCULATE_CHECKSUM);
        view.setUint32(1, this.currentObject.offset, true);
        view.setInt32(5, this.currentObject.crc, true);

        const event = new Event('characteristicvaluechanged');
        Object.defineProperty(event, 'target', { value: { value: view } });
        this.controlChar.dispatchEvent(event);
    }
}
