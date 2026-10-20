/** Avoid timer clamping when the bootloader explicitly reports no wait. */
export function afterDfuDelay(callback: () => void, delay: number): void {
    if (delay === 0) callback();
    else setTimeout(callback, delay);
}
