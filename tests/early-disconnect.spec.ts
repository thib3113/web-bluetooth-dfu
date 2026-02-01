import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { NordicDfuDevice } from './mocks/nordic-device';

describe('Early Disconnect', () => {
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

    it('should handle disconnect during service discovery', async () => {
        mockDevice = new NordicDfuDevice();
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Simulate disconnect immediately after connect
        // We can hook into the mock's connect method?
        // MockBluetoothRemoteGATTServer.connect

        const gatt = mockDevice.device.gatt!;
        const originalConnect = gatt.connect.bind(gatt);

        gatt.connect = async () => {
            await originalConnect();
            // Simulate disconnect immediately
            setTimeout(() => {
                gatt.disconnect();
            }, 10);
            return gatt as any;
        };

        const init = new ArrayBuffer(100);
        const fw = new ArrayBuffer(100);

        // Expect update to fail with a disconnect error or "Unable to find DFU service" or similar
        // Because getPrimaryService will likely fail if disconnected, or getCharacteristics.
        await expect(secureDfu.update(mockDevice.device, init, fw))
            .rejects.toThrow();
    });
});
