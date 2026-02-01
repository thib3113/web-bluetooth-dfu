import JSZip from 'jszip';

export interface DfuPackageOptions {
    firmwareSize?: number;
    initPacketSize?: number;
    type?: 'application' | 'softdevice' | 'bootloader' | 'softdevice_bootloader';
}

export async function createDfuPackage(options: DfuPackageOptions = {}): Promise<ArrayBuffer> {
    const {
        firmwareSize = 1024,
        initPacketSize = 64,
        type = 'application'
    } = options;

    const zip = new JSZip();

    // Create Dummy Firmware (.bin)
    const firmwareData = new Uint8Array(firmwareSize);
    for (let i = 0; i < firmwareSize; i++) {
        firmwareData[i] = i % 256;
    }
    const binFileName = "firmware.bin";
    zip.file(binFileName, firmwareData);

    // Create Dummy Init Packet (.dat)
    const initData = new Uint8Array(initPacketSize);
    for (let i = 0; i < initPacketSize; i++) {
        initData[i] = (i + 1) % 256;
    }
    const datFileName = "firmware.dat";
    zip.file(datFileName, initData);

    // Create Manifest
    const manifest = {
        manifest: {
            [type]: {
                bin_file: binFileName,
                dat_file: datFileName
            }
        }
    };
    zip.file("manifest.json", JSON.stringify(manifest));

    // Generate Zip Buffer
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    return buffer;
}
