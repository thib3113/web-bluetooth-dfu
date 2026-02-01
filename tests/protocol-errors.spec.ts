import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice, EXTENDED_ERRORS } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

const OPCODES = {
    CREATE: 0x01,
};

describe('Protocol Errors', () => {
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

    it('should fail when device reports Firmware Version Failure', async () => {
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            forceExtendedError: {
                opCode: OPCODES.CREATE, // Fail on creating object (e.g. init packet rejected)
                code: EXTENDED_ERRORS.FIRMWARE_VERSION_FAILURE
            }
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(true, null);

        // Should reject with specific error message
        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow(/Firmware version failure/);
    });

    it('should fail when device reports Insufficient Space', async () => {
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            forceExtendedError: {
                opCode: OPCODES.CREATE,
                code: EXTENDED_ERRORS.INSUFFICIENT_SPACE
            }
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(true, null);

        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow(/Insufficient space/);
    });

    it('should detect CRC mismatch and fail', async () => {
        // If the library implements retry on CRC mismatch, this test might hang or retry N times then fail.
        // The current library implementation `transferObject`:
        // .then(response => { ... if (this.checkCrc(...)) { ... EXECUTE } else { throw new Error("CRC fail") } })
        // It throws "CRC fail". It does NOT seem to retry the object automatically in `transferObject`.
        // So it should fail immediately.

        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            forceCrcMismatch: true
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(true, null);

        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow(/CRC fail/);
    });
});
