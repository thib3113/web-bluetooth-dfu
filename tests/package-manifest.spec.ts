import { describe, it, expect } from 'vitest';
import { SecureDfuPackage } from '../src/package';
import { createDfuPackage } from './utils/zip-generator';

describe('SecureDfuPackage Manifest Getter', () => {
    it('should return null before load()', () => {
        const buffer = new ArrayBuffer(0); // Dummy buffer
        const pack = new SecureDfuPackage(buffer);
        expect(pack.manifest).toBeNull();
    });

    it('should return an immutable manifest object after load()', async () => {
        const zipBuffer = await createDfuPackage({ firmwareSize: 1024 });
        const pack = new SecureDfuPackage(zipBuffer);
        await pack.load();

        const manifest1 = pack.manifest as any;
        expect(manifest1).toBeTruthy();
        expect(manifest1.application).toBeDefined();

        // Check immutability / cloning
        manifest1.application.newProp = "modified";

        const manifest2 = pack.manifest as any;
        expect(manifest2.application.newProp).toBeUndefined();
        expect(manifest2).not.toBe(manifest1);
    });
});
