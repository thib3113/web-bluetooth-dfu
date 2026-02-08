/*
* Web Bluetooth DFU
* Copyright (c) 2018 Rob Moran
*
* The MIT License (MIT)
*/

import * as JSZip from "jszip";

export interface ManifestEntry {
    bin_file: string;
    dat_file: string;
    // Allow for potential extra fields in future specs
    [key: string]: any;
}

export interface SecureDfuManifest {
    application?: ManifestEntry;
    softdevice?: ManifestEntry;
    bootloader?: ManifestEntry;
    softdevice_bootloader?: ManifestEntry;
    // Allow for potential extra fields
    [key: string]: any;
}

export class SecureDfuPackage {
    private zipFile: any = null;
    private _manifest: SecureDfuManifest | null = null;

    constructor(private buffer: ArrayBuffer) {}

    public get manifest(): SecureDfuManifest | null {
        return this._manifest ? JSON.parse(JSON.stringify(this._manifest)) : null;
    }

    public async load(): Promise<SecureDfuPackage> {
        this.zipFile = await JSZip.loadAsync(this.buffer);
        const manifestFile = this.zipFile.file("manifest.json");
        if (!manifestFile) {
            throw new Error("Unable to find manifest, is this a proper DFU package?");
        }
        const content = await manifestFile.async("string");
        this._manifest = JSON.parse(content).manifest as SecureDfuManifest;
        return this;
    }

    private async getImage(types: string[]): Promise<any> {
        if (!this._manifest) return null;

        for (const type of types) {
            if (this._manifest[type]) {
                const entry = this._manifest[type];
                const result: any = {
                    type: type,
                    initFile: entry.dat_file,
                    imageFile: entry.bin_file
                };
    
                result.initData = await this.zipFile.file(result.initFile).async("arraybuffer");
                result.imageData = await this.zipFile.file(result.imageFile).async("arraybuffer");
                return result;
            }
        }
        return null;
    }

    public getBaseImage(): Promise<any> {
        return this.getImage(["softdevice", "bootloader", "softdevice_bootloader"]);
    }

    public getAppImage(): Promise<any> {
        return this.getImage(["application"]);
    }
}
