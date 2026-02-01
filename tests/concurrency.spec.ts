import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('Concurrency', () => {
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

    it('should fail or hang when concurrent updates are attempted', async () => {
        // This test demonstrates that concurrent updates on the same instance are unsafe
        // and lead to hanging (deadlock) due to overwritten notifyFns.

        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // Start two updates concurrently
        const p1 = secureDfu.update(device, image.initData, image.imageData);
        const p2 = secureDfu.update(device, image.initData, image.imageData);

        // We use a race to detect if they finish or hang.
        // Since we know they hang (due to notifyFns overwrite), we expect a timeout.
        const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000));

        const result = await Promise.race([Promise.all([p1, p2]), timeout]);

        // If result is 'timeout', it means they hung, which is the expected unsafe behavior.
        // If they threw errors, that's also acceptable.
        // We just want to ensure we don't get a silent success for both (which would be wrong).

        expect(result).toBe('timeout');
    });
});
