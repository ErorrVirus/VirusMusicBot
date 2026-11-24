const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const roots = ['src', 'tests', 'scripts'];
const files = [];

function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
}

roots.forEach(walk);

for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
