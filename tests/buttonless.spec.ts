import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { NordicDfuDevice } from './mocks/nordic-device';

describe('Buttonless DFU', () => {
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

    it('should switch to bootloader mode via Buttonless characteristic', async () => {
        mockDevice = new NordicDfuDevice();
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Request device in buttonless mode
        const resultDevice = await secureDfu.requestDevice(true, null);

        // The library logic for setDfuMode:
        // 1. Connects to device
        // 2. Finds Buttonless char
        // 3. Writes 0x01
        // 4. Waits for disconnect
        // 5. Returns device (or null/void depending on impl)

        // In the mock, we simulate disconnect after write.
        // The secureDfu.requestDevice returns promise that resolves when flow completes.

        // The library `setDfuMode` implementation resolves with `null` when complete (according to source).
        // Wait, looking at code: `resolve(null)` inside `complete()`.

        expect(resultDevice).toBeNull();

        // Verify disconnect happened (simulated)
        // Disconnect is async in the mock (50ms delay)
        await new Promise(r => setTimeout(r, 100));
        expect(mockDevice.device.gatt?.connected).toBe(false);
    });
});
