import { vi } from 'vitest';

export class MockBluetoothRemoteGATTCharacteristic implements Partial<BluetoothRemoteGATTCharacteristic> {
    public service: BluetoothRemoteGATTService;
    public uuid: string;
    public properties: BluetoothCharacteristicProperties;
    public value?: DataView;
    public oncharacteristicvaluechanged: ((this: BluetoothRemoteGATTCharacteristic, ev: Event) => any) | null = null;

    private listeners: Record<string, EventListener[]> = {};

    constructor(service: BluetoothRemoteGATTService, uuid: string, properties: Partial<BluetoothCharacteristicProperties> = {}) {
        this.service = service;
        this.uuid = uuid;
        this.properties = properties as BluetoothCharacteristicProperties;
    }

    async getDescriptor(descriptor: string | number): Promise<BluetoothRemoteGATTDescriptor> {
        throw new Error("Method not implemented.");
    }

    async getDescriptors(descriptor?: string | number): Promise<BluetoothRemoteGATTDescriptor[]> {
        throw new Error("Method not implemented.");
    }

    async readValue(): Promise<DataView> {
        if (!this.value) {
            return new DataView(new ArrayBuffer(0));
        }
        return this.value;
    }

    async writeValue(value: BufferSource): Promise<void> {
        // To be intercepted by the device logic
        if (value instanceof DataView) {
            this.value = value;
        } else if (value instanceof ArrayBuffer) {
            this.value = new DataView(value);
        } else {
            this.value = new DataView((value as Uint8Array).buffer);
        }
    }

    async writeValueWithResponse(value: BufferSource): Promise<void> {
        return this.writeValue(value);
    }

    async writeValueWithoutResponse(value: BufferSource): Promise<void> {
        return this.writeValue(value);
    }

    async startNotifications(): Promise<BluetoothRemoteGATTCharacteristic> {
        return this;
    }

    async stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic> {
        return this;
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(listener as EventListener);
    }

    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
         if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(l => l !== callback);
        }
    }

    dispatchEvent(event: Event): boolean {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(l => l(event));
        }
        if (event.type === 'characteristicvaluechanged' && this.oncharacteristicvaluechanged) {
            this.oncharacteristicvaluechanged.call(this as any, event);
        }
        return true;
    }
}

export class MockBluetoothRemoteGATTService implements Partial<BluetoothRemoteGATTService> {
    public device: BluetoothDevice;
    public uuid: string;
    public isPrimary: boolean = true;
    private characteristics: MockBluetoothRemoteGATTCharacteristic[] = [];

    constructor(device: BluetoothDevice, uuid: string) {
        this.device = device;
        this.uuid = uuid;
    }

    addCharacteristic(uuid: string, properties: Partial<BluetoothCharacteristicProperties> = {}) {
        const char = new MockBluetoothRemoteGATTCharacteristic(this as any, uuid, properties);
        this.characteristics.push(char);
        return char;
    }

    async getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic> {
        const char = this.characteristics.find(c => c.uuid === characteristic);
        if (!char) throw new Error(`Characteristic ${characteristic} not found`);
        return char as any;
    }

    async getCharacteristics(characteristic?: string | number): Promise<BluetoothRemoteGATTCharacteristic[]> {
        if (characteristic) {
             return this.characteristics.filter(c => c.uuid === characteristic) as any[];
        }
        return this.characteristics as any[];
    }

    async getIncludedService(service: string | number): Promise<BluetoothRemoteGATTService> {
        throw new Error("Method not implemented.");
    }

    async getIncludedServices(service?: string | number): Promise<BluetoothRemoteGATTService[]> {
        throw new Error("Method not implemented.");
    }
}

export class MockBluetoothRemoteGATTServer implements Partial<BluetoothRemoteGATTServer> {
    public device: BluetoothDevice;
    public connected: boolean = false;
    private services: MockBluetoothRemoteGATTService[] = [];

    constructor(device: BluetoothDevice) {
        this.device = device;
    }

    addService(uuid: string) {
        const service = new MockBluetoothRemoteGATTService(this.device, uuid);
        this.services.push(service);
        return service;
    }

    async connect(): Promise<BluetoothRemoteGATTServer> {
        this.connected = true;
        return this as any;
    }

    disconnect(): void {
        this.connected = false;
        this.device.dispatchEvent(new Event('gattserverdisconnected'));
    }

    async getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService> {
        if (!this.connected) throw new Error("GATT Server not connected");
        // Normalize UUID
        const uuidStr = typeof service === 'number' ? `0x${service.toString(16)}` : service; // Simplified normalization
        // In real web bluetooth, UUIDs are normalized. Here we just do exact match or simple number match
        const found = this.services.find(s => s.uuid === service || (typeof service === 'number' && s.uuid === service.toString()));
        if (!found) throw new Error(`Service ${service} not found`);
        return found as any;
    }

    async getPrimaryServices(service?: string | number): Promise<BluetoothRemoteGATTService[]> {
        if (!this.connected) throw new Error("GATT Server not connected");
         if (service) {
             return this.services.filter(s => s.uuid === service) as any[];
         }
        return this.services as any[];
    }
}

export class MockBluetoothDevice implements Partial<BluetoothDevice> {
    public id: string;
    public name?: string;
    public gatt?: BluetoothRemoteGATTServer;
    private listeners: Record<string, EventListener[]> = {};

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.gatt = new MockBluetoothRemoteGATTServer(this as any) as any;
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(listener as EventListener);
    }

    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
        if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(l => l !== callback);
        }
    }

    dispatchEvent(event: Event): boolean {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(l => l(event));
        }
        return true;
    }

    async watchAdvertisements(options?: WatchAdvertisementsOptions): Promise<void> {}
    async unwatchAdvertisements(): Promise<void> {}

    get watchingAdvertisements() { return false; }
    onadvertisementreceived = null;
    ongattserverdisconnected = null;
    onmessagereceived = null;
    onservicechanged = null;
    forget = async () => {};

}

export class MockBluetooth implements Partial<Bluetooth> {
    private devices: MockBluetoothDevice[] = [];

    constructor() {}

    addDevice(device: MockBluetoothDevice) {
        this.devices.push(device);
    }

    getAvailability(): Promise<boolean> {
        return Promise.resolve(true);
    }

    async requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice> {
        if (this.devices.length > 0) {
            return this.devices[0] as any;
        }
        throw new Error("No device found");
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {}
    dispatchEvent(event: Event): boolean { return true; }

    onavailabilitychanged = null;
    onadvertisementreceived = null;
    getDevices = async () => this.devices as any[];
}
