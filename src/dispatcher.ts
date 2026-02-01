/**
 * Minimal browser-compatible event dispatcher.
 * Replaces Node.js EventEmitter to allow valid browser bundling without polyfills.
 */
export class EventDispatcher {
    private listeners: { [key: string]: Array<(...args: any[]) => void> } = {};

    public addEventListener(event: string, listener: (...args: any[]) => void) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    public removeEventListener(event: string, listener: (...args: any[]) => void) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(l => l !== listener);
    }

    public dispatchEvent(eventType: string, event?: any) {
        if (!this.listeners[eventType]) return;
        this.listeners[eventType].forEach(listener => listener(event));
    }
}
