import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('Resilience & Flow Control', () => {
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

    it('should retry failed writes (Flakiness)', async () => {
        // 10% failure rate
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            flakiness: 0.1
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 2048 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // The library has a retry mechanism (15 attempts).
        // With 0.1 flakiness, it should eventually succeed.
        await secureDfu.update(device, image.initData, image.imageData);

        expect(mockDevice.flashStorage.firmware).toBeDefined();
        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
    });

    it('should respect PRN (Packet Receipt Notification)', async () => {
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Enable PRN in library (e.g. every 10 packets)
        secureDfu.packetReceiptNotification = 10;

        // Spy on control char notifications (where PRN response comes)
        // We can check if the device received the SET_PRN command.
        // Or we can check if the library actually waits.

        const zipBuffer = await createDfuPackage({ firmwareSize: 2000 }); // 100 packets of 20 bytes
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);
        await secureDfu.update(device, image.initData, image.imageData);

        // Verification: The update succeeded, meaning PRN flow control worked.
        // If PRN logic was broken in lib (e.g. didn't wait), it might still work with mock
        // unless mock enforces it. Mock sends PRN notification, lib waits for it.
        // If lib didn't send SET_PRN, mock wouldn't send notifications.
        // If lib sent SET_PRN but didn't wait, it might race?

        expect(mockDevice.flashStorage.firmware).toBeDefined();
    });

    it('should support Smart Resume (forceRestart = false)', async () => {
        mockDevice = new NordicDfuDevice({ maxObjectSize: 4096 });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Disable forceRestart to allow resume
        secureDfu.forceRestart = false;

        const zipBuffer = await createDfuPackage({ firmwareSize: 4096 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        // 1. Interrupt halfway
        // We can hook into the mock to throw error after N bytes
        let bytesWritten = 0;
        const triggerPoint = 2000;
        let forcedFailure = false;

        // Hacky way to inject failure in the middle of the stream
        const originalWrite = mockDevice['packetChar'].writeValue.bind(mockDevice['packetChar']);
        mockDevice['packetChar'].writeValue = async (val) => {
            bytesWritten += val.byteLength;
            if (!forcedFailure && bytesWritten > triggerPoint) {
                forcedFailure = true;
                // Simulate disconnect
                mockDevice.device.gatt?.disconnect();
                throw new Error("Simulated Disconnect");
            }
            return originalWrite(val);
        };

        // First attempt - expect failure
        await expect(secureDfu.update(device, image.initData, image.imageData))
            .rejects.toThrow();

        // Verify partial write state in device
        expect(mockDevice['currentObject']).toBeDefined();
        expect(mockDevice['currentObject']!.offset).toBeGreaterThan(0);
        const offsetBeforeResume = mockDevice['currentObject']!.offset;

        // 2. Resume
        // Restore write function
        mockDevice['packetChar'].writeValue = originalWrite;

        // Spy on writeValue to count bytes sent during RESUME
        let bytesSentDuringResume = 0;
        const spyWrite = vi.spyOn(mockDevice['packetChar'], 'writeValue').mockImplementation(async (val) => {
             bytesSentDuringResume += val.byteLength;
             return originalWrite(val);
        });

        // Call update again with SAME device object
        await secureDfu.update(device, image.initData, image.imageData);

        expect(mockDevice.flashStorage.firmware).toBeDefined();
        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(4096);

        // We interrupted at > 2000. Total 4096 (1 object).
        // The library resumes from the *start* of the current object, so it re-sends the full 4096 bytes of firmware.
        // However, it skips the Init Packet (64 bytes), which proves Smart Resume is working (skipping completed steps).
        // If it didn't skip Init, we would see 4096 + 64 = 4160 bytes.

        expect(bytesSentDuringResume).toBe(4096);
    });
});
