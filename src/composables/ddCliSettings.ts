export function settingAcknowledged(lines: string[], name: string, value: string): boolean {
    if (lines.some((line) => /###\s*ERROR|UNKNOWN COMMAND|INVALID|FAILED/i.test(line))) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\s*${escaped}\\s*(?:=|set to)\\s*(.*?)\\s*$`, "i");
    return lines.some((line) => pattern.exec(line)?.[1].toUpperCase() === value.toUpperCase());
}

export function streamSettingsFromDump(text: string): Map<string, string> {
    const settings = new Map<string, string>();
    for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const match =
            /^\s*set\s+(msp_telemetry_stream\w*|serialrx_halfduplex|serial_update_rate_hz)\s*=\s*([^#\r\n]+?)\s*$/i.exec(
                line,
            );
        if (match) settings.set(match[1].toLowerCase(), match[2].trim());
    }
    if (!settings.size) throw new Error("В дампе нет настроек msp_telemetry_stream. Ничего не изменено.");
    for (const name of ["msp_telemetry_stream_port", "serialrx_halfduplex", "serial_update_rate_hz"]) {
        if (!settings.has(name)) throw new Error(`В дампе отсутствует ${name}. Ничего не изменено.`);
    }
    return settings;
}
