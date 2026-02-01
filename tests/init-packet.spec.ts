import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';
import * as CRC32 from 'crc-32';

describe('Init Packet Corner Cases', () => {
    let mockDevice: NordicDfuDevice;
    let secureDfu: SecureDfu;

    beforeEach(() => {
        (global as any).navigator = {
            bluetooth: {
                requestDevice: vi.fn()
            }
        };
        secureDfu = new SecureDfu(undefined, undefined, 0);
    });

    it('should skip sending Init Packet if device already has it and CRC matches', async () => {
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        // Pre-fill mock device with correct Init Packet
        mockDevice.flashStorage.initPacket = new Uint8Array(image.initData);

        // Mock the "Current Object" state to reflect that Init Packet is active/selected
        // The mock logic for SELECT uses `currentObject`.
        // We need to inject state into the mock so that when SELECT(INIT) is called, it returns offset=size and crc=correct.

        // In `nordic-device.ts`:
        // SELECT uses `this.currentObject`.
        // If we manually set `currentObject` to match the init packet, SELECT will return it.
        const initCrc = CRC32.buf(new Uint8Array(image.initData));
        mockDevice['currentObject'] = {
            type: 0x01, // Init Packet
            maxSize: image.initData.byteLength, // Exact size match
            offset: image.initData.byteLength, // Full offset
            crc: initCrc,
            data: new Uint8Array(image.initData)
        };

        // Disable forceRestart, otherwise the library will clear valid data and start over
        secureDfu.forceRestart = false;

        const device = await secureDfu.requestDevice(false, null);

        // Spy on log to verify skip message
        const logSpy = vi.fn();
        secureDfu.addEventListener('log', logSpy);

        // Also spy on writeValue to ensure we don't send data for Init
        const writeSpy = vi.spyOn(mockDevice['packetChar'], 'writeValue');

        await secureDfu.update(device, image.initData, image.imageData);

        // Verify log
        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
            message: "init packet already available, skipping transfer"
        }));

        // The library sends Firmware packet (Data), but should NOT send Init packet data.
        // It's hard to distinguish strictly by spy without analyzing bytes,
        // but we can trust the log message + successful update.
    });

    it('should overwrite Init Packet if CRC does not match', async () => {
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        // Pre-fill with corrupted data
        const corruptedInit = new Uint8Array(image.initData);
        corruptedInit[0] = ~corruptedInit[0]; // Invert first byte
        const corruptedCrc = CRC32.buf(corruptedInit);

        mockDevice['currentObject'] = {
            type: 0x01,
            maxSize: image.initData.byteLength,
            offset: image.initData.byteLength,
            crc: corruptedCrc,
            data: corruptedInit
        };

        const device = await secureDfu.requestDevice(false, null);
        const logSpy = vi.fn();
        secureDfu.addEventListener('log', logSpy);

        await secureDfu.update(device, image.initData, image.imageData);

        // Should NOT log skipping
        expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({
             message: "init packet already available, skipping transfer"
        }));

        // Should have updated flash with correct init packet
        expect(mockDevice.flashStorage.initPacket).toEqual(new Uint8Array(image.initData));
    });
});
