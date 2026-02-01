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

    it('should reduce MTU progressively (100 -> 50) when Smart Speed is enabled', async () => {
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
        // Fails 4 times: 3 retries + 1 degradation trigger
        let failureCount = 0;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            // Fail on 5th packet
            if (secureDfu['packetsSentSincePRN'] === 5 && failureCount < 4) {
                 failureCount++;
                 throw new Error("Simulated GATT Error");
            }
            return originalWrite(val);
        };

        await secureDfu.update(device, image.initData, image.imageData);

        // It should have failed 4 times.
        // 1st Fail: Retry 1
        // 2nd Fail: Retry 2
        // 3rd Fail: Retry 3
        // 4th Fail: Degrade -> Success
        expect(failureCount).toBe(4);

        // MTU should drop to 50 (100 / 2). PRN stays 10.
        expect(secureDfu.packetSize).toBe(50);
        expect(secureDfu.packetReceiptNotification).toBe(10);

        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });

    it('should retry 3 times before degrading parameters', async () => {
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
        // Fails 3 times (Simulating transient errors)
        // Then succeeds on 4th try (Retry #3)
        let failureCount = 0;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            if (secureDfu['packetsSentSincePRN'] === 5 && failureCount < 3) {
                failureCount++;
                throw new Error("Transient GATT Error");
            }
            return originalWrite(val);
        };

        await secureDfu.update(device, image.initData, image.imageData);

        // Expect 3 failures
        expect(failureCount).toBe(3);

        // Params should NOT change because it succeeded within the 3 retries
        expect(secureDfu.packetSize).toBe(100);
        expect(secureDfu.packetReceiptNotification).toBe(10);

        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });

    it('should reduce PRN if MTU is already at floor (20)', async () => {
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

        let failureCount = 0;
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            if (secureDfu['packetsSentSincePRN'] === 5 && failureCount < 4) {
                failureCount++;
                throw new Error("Simulated GATT Error");
            }
            return originalWrite(val);
        };

        await secureDfu.update(device, image.initData, image.imageData);

        // PRN should drop (10 -> 5) after 3 retries
        expect(secureDfu.packetReceiptNotification).toBe(5);
        expect(secureDfu.packetSize).toBe(20);

        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });
});
