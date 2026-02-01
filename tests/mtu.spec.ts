import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('MTU Constraints', () => {
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

    it('should succeed when packet size <= Device MTU', async () => {
        // Device MTU = 20 (standard legacy BLE)
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096, mtu: 20 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        secureDfu.packetSize = 20; // Match MTU

        const zipBuffer = await createDfuPackage({ firmwareSize: 100 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);
        await secureDfu.update(device, image.initData, image.imageData);

        expect(mockDevice.flashStorage.firmware).toBeDefined();
    });

    it('should fail when packet size > Device MTU', async () => {
        // Device MTU = 20
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096, mtu: 20 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        secureDfu.packetSize = 25; // Exceeds MTU

        const zipBuffer = await createDfuPackage({ firmwareSize: 100 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // Expect write failure
        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow(/Value is longer than maximum length/);
    });
});
