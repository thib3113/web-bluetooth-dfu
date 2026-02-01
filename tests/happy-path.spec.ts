import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('SecureDfu Happy Path', () => {
    let mockDevice: NordicDfuDevice;
    let secureDfu: SecureDfu;

    beforeEach(() => {
        // Setup a "standard" device (e.g. nRF52 default)
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            flakiness: 0
        });

        // Mock global navigator.bluetooth
        (global as any).navigator = {
            bluetooth: {
                requestDevice: vi.fn().mockResolvedValue(mockDevice.device)
            }
        };

        secureDfu = new SecureDfu(undefined, undefined, 0); // No extra delay for tests
    });

    it('should successfully perform a full DFU update', async () => {
        // 1. Create a package
        const zipBuffer = await createDfuPackage({ firmwareSize: 8192 }); // 2 objects of 4096
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();

        const image = await pack.getAppImage();
        expect(image).toBeTruthy();

        // 2. Setup progress listener
        const progressSpy = vi.fn();
        secureDfu.addEventListener('progress', progressSpy);

        // 3. Request device (simulated selection)
        const device = await secureDfu.requestDevice(true, null);
        expect(device).toBe(mockDevice.device);

        // 4. Start Update
        await secureDfu.update(device, image.initData, image.imageData);

        // 5. Verify Flash Content
        // Init Packet
        expect(mockDevice.flashStorage.initPacket).toBeDefined();
        expect(mockDevice.flashStorage.initPacket!.byteLength).toBe(image.initData.byteLength);

        // Firmware
        expect(mockDevice.flashStorage.firmware).toBeDefined();
        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(image.imageData.byteLength);

        // Verify content
        const expectedFw = new Uint8Array(image.imageData);
        const writtenFw = mockDevice.flashStorage.firmware!;
        expect(writtenFw).toEqual(expectedFw);

        // Verify Progress
        // Should have been called multiple times
        expect(progressSpy).toHaveBeenCalled();
        const lastCall = progressSpy.mock.calls[progressSpy.mock.calls.length - 1][0];
        expect(lastCall.object).toBe("firmware");
        expect(lastCall.sentBytes).toBe(image.imageData.byteLength);
    });
});
