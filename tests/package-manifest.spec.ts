import { describe, it, expect } from 'vitest';
import { SecureDfuPackage, SecureDfuManifest } from '../src/package';
import { createDfuPackage } from './utils/zip-generator';

describe('SecureDfuPackage Manifest Getter', () => {
    it('should return null before load()', () => {
        const buffer = new ArrayBuffer(0); // Dummy buffer
        const pack = new SecureDfuPackage(buffer);
        expect(pack.manifest).toBeNull();
    });

    it('should return an immutable manifest object after load()', async () => {
        const zipBuffer = await createDfuPackage({ firmwareSize: 1024, type: 'application' });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();

        const manifest1 = pack.manifest;
        expect(manifest1).toBeTruthy();

        // Type assertion (runtime check)
        expect(manifest1!.application).toBeDefined();
        expect(manifest1!.application!.bin_file).toBe('firmware.bin');
        expect(manifest1!.application!.dat_file).toBe('firmware.dat');

        // Check immutability / cloning
        (manifest1 as any).application.newProp = "modified";

        const manifest2 = pack.manifest;
        expect((manifest2 as any).application.newProp).toBeUndefined();
        expect(manifest2).not.toBe(manifest1);
    });
});
