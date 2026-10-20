export interface DumpComparison {
    matched: string[];
    mismatched: string[];
    unchecked: string[];
}

export function dumpCommands(text: string): string[] {
    return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

function indexDump(lines: string[]) {
    let profile = '0';
    let rate = '0';
    let section = '';
    const values = new Map<string, string>();
    const features = new Set<string>();
    for (const raw of lines) {
        const line = raw.trim();
        if (/^# profile$/i.test(line)) section = 'profile';
        else if (/^# rateprofile$/i.test(line)) section = 'rate';
        else if (/^# master$/i.test(line)) section = '';
        const p = /^profile (\d+)$/.exec(line);
        const r = /^rateprofile (\d+)$/.exec(line);
        if (p) { profile = p[1]; section = 'profile'; }
        if (r) { rate = r[1]; section = 'rate'; }
        const setting = /^set (\w+)\s*=\s*(.*)$/.exec(line);
        if (setting) {
            const context = section === 'profile' ? `p${profile}` : section === 'rate' ? `r${rate}` : 'master';
            values.set(`${context}:${setting[1]}`, setting[2].trim());
        }
        if (line.startsWith('feature -')) features.delete(line.slice(9));
        else if (line.startsWith('feature ')) features.add(line.slice(8));
    }
    return { values, features };
}

// Number of identity fields after the command, not including its value.
const rowKeys: Record<string, number> = {
    resource: 2, timer: 1, dma: 2, serial: 1, servo: 1, led: 1, color: 1,
    mode_color: 2, aux: 1, adjrange: 1, rxrange: 1, vtx: 1, rxfail: 1,
    board_name: 0, manufacturer_id: 0, mcu_id: 0, signature: 0, mixer: 0,
    map: 0, name: 0, vtxtable: 1,
};

function indexRows(text: string) {
    const rows = new Map<string, string>();
    const toggles = new Map<string, boolean>();
    const mixes = new Map<string, string>();
    const resets = new Set<string>();
    const unknown: string[] = [];
    for (const line of dumpCommands(text)) {
        const parts = line.split(/\s+/);
        const command = parts[0];
        if (/^(set|feature|profile|rateprofile|save|batch|defaults)$/.test(command)) continue;
        if (['beeper', 'beacon'].includes(command) && parts.length === 2) {
            toggles.set(`${command} ${parts[1].replace(/^-/, '')}`, !parts[1].startsWith('-'));
        } else if (['mmix', 'smix'].includes(command)) {
            if (parts[1] === 'reset') {
                for (const key of mixes.keys()) if (key.startsWith(command + ' ')) mixes.delete(key);
                resets.add(command);
            } else {
                const keyLength = command === 'smix' && parts[1] === 'reverse' ? 4 : 2;
                mixes.set(parts.slice(0, keyLength).join(' '), parts.slice(keyLength).join(' '));
            }
        } else if (Object.hasOwn(rowKeys, command)) {
            const count = command === 'vtxtable' && parts[1] === 'band' ? 3 : rowKeys[command] + 1;
            rows.set(parts.slice(0, count).join(' '), parts.slice(count).join(' '));
        } else unknown.push(line);
    }
    return { rows, toggles, mixes, resets, unknown };
}

export function compareDump(source: string, actual: string): DumpComparison {
    const result: DumpComparison = { matched: [], mismatched: [], unchecked: [] };
    const expected = indexDump(source.split(/\r?\n/));
    const readback = indexDump(actual.split(/\r?\n/));
    for (const [key, value] of expected.values) {
        const found = readback.values.get(key);
        // A partial CLI file may omit section comments. Only accept an unambiguous setting.
        const candidates = [...readback.values].filter(([k]) => k.endsWith(`:${key.split(':')[1]}`));
        const observed = found ?? (key.startsWith('master:') && candidates.length === 1 ? candidates[0][1] : undefined);
        if (observed === value) result.matched.push(`${key} = ${value}`);
        else result.mismatched.push(`${key}: ожидалось «${value}», считано «${observed ?? 'не найдено'}»`);
    }
    const featureCommands = dumpCommands(source).filter(line => line.startsWith('feature '));
    const featureNames = new Set(featureCommands.map(line => line.replace(/^feature -?/, '')));
    for (const name of featureNames) {
        const enabled = expected.features.has(name);
        const message = `feature ${enabled ? '' : '-'}${name}`;
        (readback.features.has(name) === enabled ? result.matched : result.mismatched).push(message);
    }
    const expectedRows = indexRows(source);
    const actualRows = indexRows(actual);
    for (const category of ['rows', 'toggles', 'mixes'] as const) {
        for (const [key, value] of expectedRows[category]) {
            const found = actualRows[category].get(key);
            if (found === value) result.matched.push(`${key} ${value}`.trim());
            else result.mismatched.push(`${key}: ожидалось «${value}», считано «${found ?? 'не найдено'}»`);
        }
    }
    for (const command of expectedRows.resets) {
        // A reset also requires that no old mixer rows survive in the readback.
        const extras = [...actualRows.mixes.keys()].filter(key => key.startsWith(command + ' ') && !expectedRows.mixes.has(key));
        if (!actualRows.resets.has(command)) result.unchecked.push(`${command} reset: отсутствует секция в dump all`);
        else if (extras.length) result.mismatched.push(`${command} reset: остались лишние строки: ${extras.join(', ')}`);
        else result.matched.push(`${command} reset`);
    }
    result.unchecked.push(...expectedRows.unknown);
    return result;
}
