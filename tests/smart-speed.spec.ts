import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('Smart Speed Degradation', () => {
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

    it('should fail immediately on error when Smart Speed is disabled', async () => {
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            mtu: 512
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // High speed settings
        secureDfu.packetReceiptNotification = 10;
        secureDfu.packetSize = 100;

        const zipBuffer = await createDfuPackage({ firmwareSize: 2048 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // Inject Failure: Fail on the 5th packet write
        let writeCount = 0;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            writeCount++;
            if (writeCount === 5) {
                throw new Error("Simulated GATT Error");
            }
            return originalWrite(val);
        };

        // Expect failure
        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow("Simulated GATT Error");

        // Ensure params did not change
        expect(secureDfu.packetReceiptNotification).toBe(10);
        expect(secureDfu.packetSize).toBe(100);
    });

    it('should reduce MTU first when Smart Speed is enabled', async () => {
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            mtu: 512
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        secureDfu.enableSmartSpeed = true;
        secureDfu.packetReceiptNotification = 10;
        secureDfu.packetSize = 100;

        const zipBuffer = await createDfuPackage({ firmwareSize: 2048 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // Inject Failure
        let writeCount = 0;
        let hasFailed = false;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            writeCount++;
            if (writeCount === 5 && !hasFailed) {
                hasFailed = true;
                throw new Error("Simulated GATT Error");
            }
            return originalWrite(val);
        };

        await secureDfu.update(device, image.initData, image.imageData);

        // MTU should drop to 20. PRN stays 10 (prioritize MTU fix).
        expect(secureDfu.packetSize).toBe(20);
        expect(secureDfu.packetReceiptNotification).toBe(10);

        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });

    it('should reduce PRN if MTU is already safe', async () => {
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            mtu: 512
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        secureDfu.enableSmartSpeed = true;
        secureDfu.packetReceiptNotification = 10;
        secureDfu.packetSize = 20; // Already safe

        const zipBuffer = await createDfuPackage({ firmwareSize: 2048 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        let writeCount = 0;
        let hasFailed = false;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            writeCount++;
            if (writeCount === 5 && !hasFailed) {
                hasFailed = true;
                throw new Error("Simulated GATT Error");
            }
            return originalWrite(val);
        };

        await secureDfu.update(device, image.initData, image.imageData);

        // PRN should drop (10 -> 5)
        expect(secureDfu.packetReceiptNotification).toBe(5);
        expect(secureDfu.packetSize).toBe(20);

        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });
});
