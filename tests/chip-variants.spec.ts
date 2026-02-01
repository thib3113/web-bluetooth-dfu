import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureDfu } from '../src/secure-dfu';
import { SecureDfuPackage } from '../src/package';
import { NordicDfuDevice } from './mocks/nordic-device';
import { createDfuPackage } from './utils/zip-generator';

describe('Chip Variants (Performance & Constraints)', () => {
    let mockDevice: NordicDfuDevice;
    let secureDfu: SecureDfu;

    beforeEach(() => {
        // Default setup, can be overridden in tests
        (global as any).navigator = {
            bluetooth: {
                requestDevice: vi.fn() // Will be mocked per test
            }
        };
        secureDfu = new SecureDfu(undefined, undefined, 0);
    });

    it('should handle Low End Chip (Small MTU/Page Size)', async () => {
        // Simulator: 512 byte max object size (Very small)
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 512,
            flakiness: 0
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Package: 2048 bytes firmware (Should require 4 objects)
        const zipBuffer = await createDfuPackage({ firmwareSize: 2048 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);
        await secureDfu.update(device, image.initData, image.imageData);

        // Verify it succeeded
        expect(mockDevice.flashStorage.firmware).toBeDefined();
        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(2048);
        expect(mockDevice.flashStorage.firmware).toEqual(new Uint8Array(image.imageData));
    });

    it('should handle High End Chip (Large MTU/Page Size)', async () => {
        // Simulator: 1MB max object size (Huge)
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 1024 * 1024,
            flakiness: 0
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        // Package: 10KB firmware
        const zipBuffer = await createDfuPackage({ firmwareSize: 10240 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);
        await secureDfu.update(device, image.initData, image.imageData);

        expect(mockDevice.flashStorage.firmware).toBeDefined();
        expect(mockDevice.flashStorage.firmware!.byteLength).toBe(10240);
    });

    it('should handle slow processing speed (Delays)', async () => {
        // Simulator: 50ms write delay (simulate slow flash write or slow connection)
        mockDevice = new NordicDfuDevice({
            maxObjectSize: 4096,
            writeDelay: 10 // 10ms delay per write
        });
        (global as any).navigator.bluetooth.requestDevice.mockResolvedValue(mockDevice.device);

        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();
        const image = await pack.getAppImage();

        const device = await secureDfu.requestDevice(false, null);

        const startTime = Date.now();
        await secureDfu.update(device, image.initData, image.imageData);
        const duration = Date.now() - startTime;

        // Roughly: 1024 bytes / 20 bytes/packet ~= 51 packets
        // + Control packets (Select, Create, Checksum, Execute) ~= 4-5 packets
        // Total ~55 writes * 10ms = 550ms minimum
        expect(duration).toBeGreaterThan(500);
        expect(mockDevice.flashStorage.firmware).toBeDefined();
    });
});
