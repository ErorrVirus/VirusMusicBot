/**
 * Lavalink 15-band Equalizer & Headroom Management.
 * Lavalink valid gain range per band: -0.25 to +1.0 (0.0 = flat).
 * All 15 bands (0..14) are always emitted so changing presets resets prior bands completely.
 */

const BAND_COUNT = 15;
const MIN_GAIN = -0.25;
const MAX_GAIN = 1.0;

function clampGain(g) {
    return Number(Math.max(MIN_GAIN, Math.min(MAX_GAIN, g)).toFixed(3));
}

function buildFullBands(sparseMap = {}) {
    const bands = [];
    for (let band = 0; band < BAND_COUNT; band++) {
        bands.push({ band, gain: clampGain(sparseMap[band] ?? 0) });
    }
    return bands;
}

const PRESET_DEFINITIONS = {
    flat: {
        label: 'Flat (Neutral Studio Default)',
        lowPass: null,
        bands: buildFullBands({})
    },
    rich: {
        label: 'Rich (Balanced Warmth & Clarity)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.07, 1: 0.06, 2: 0.04, 3: 0.02,
            10: 0.02, 11: 0.03, 12: 0.03, 13: 0.02, 14: 0.01
        })
    },
    bass_boost: {
        label: 'Bass Boost (Punchy Low-End)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.16, 1: 0.14, 2: 0.10, 3: 0.05, 4: 0.02,
            6: -0.02, 11: 0.02, 12: 0.02
        })
    },
    deep_bass: {
        label: 'Deep Bass (Extended Sub-Bass)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.24, 1: 0.20, 2: 0.13, 3: 0.06, 4: 0.02,
            6: -0.03, 7: -0.02, 11: 0.02
        })
    },
    vocal: {
        label: 'Vocal (Speech & Lyric Clarity)',
        lowPass: null,
        bands: buildFullBands({
            0: -0.10, 1: -0.07, 2: -0.03,
            5: 0.08, 6: 0.13, 7: 0.15, 8: 0.12, 9: 0.07,
            12: -0.03, 13: -0.05, 14: -0.06
        })
    },
    treble: {
        label: 'Treble (Crisp Air & Detail)',
        lowPass: null,
        bands: buildFullBands({
            0: -0.02, 1: -0.02,
            9: 0.05, 10: 0.09, 11: 0.13, 12: 0.14, 13: 0.12, 14: 0.09
        })
    },
    rock: {
        label: 'Rock (Guitars & Drums)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.14, 1: 0.11, 2: 0.07, 3: 0.03,
            5: -0.03, 6: -0.05, 7: -0.02,
            9: 0.04, 10: 0.08, 11: 0.10, 12: 0.08, 13: 0.04
        })
    },
    pop: {
        label: 'Pop (Bright & Modern)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.03, 1: 0.02, 2: 0.05, 3: 0.08, 4: 0.09,
            5: 0.06, 6: 0.02, 8: 0.02, 9: 0.05, 10: 0.07, 11: 0.06, 12: 0.04
        })
    },
    electronic: {
        label: 'Electronic / EDM (Tight Sub & Synth)',
        lowPass: null,
        bands: buildFullBands({
            0: 0.20, 1: 0.16, 2: 0.09, 3: 0.02,
            5: -0.04, 6: -0.02,
            9: 0.07, 10: 0.11, 11: 0.10, 12: 0.07, 13: 0.04
        })
    },
    night_mode: {
        label: 'Night Mode (Smooth & Soft)',
        lowPass: { smoothing: 12.0 },
        bands: buildFullBands({
            0: -0.08, 1: -0.05, 2: -0.02,
            5: 0.03, 6: 0.05, 7: 0.05, 8: 0.03,
            11: -0.04, 12: -0.08, 13: -0.10, 14: -0.12
        })
    },
    // Optional bassboost intensity tiers
    bass_low: {
        label: 'Bass Boost: Low',
        lowPass: null,
        bands: buildFullBands({ 0: 0.10, 1: 0.08, 2: 0.05, 3: 0.02 })
    },
    bass_medium: {
        label: 'Bass Boost: Medium',
        lowPass: null,
        bands: buildFullBands({ 0: 0.18, 1: 0.14, 2: 0.09, 3: 0.04 })
    },
    bass_high: {
        label: 'Bass Boost: High',
        lowPass: null,
        bands: buildFullBands({ 0: 0.28, 1: 0.22, 2: 0.14, 3: 0.06, 6: -0.03 })
    },
    bass_extreme: {
        label: 'Bass Boost: Extreme (Optional)',
        lowPass: null,
        bands: buildFullBands({ 0: 0.40, 1: 0.32, 2: 0.20, 3: 0.08, 6: -0.05, 7: -0.04 })
    }
};

function computeHeadroomVolume(bands) {
    const maxPositive = bands.reduce((max, b) => Math.max(max, b.gain), 0);
    if (maxPositive <= 0.03) return 1.0;
    // Scale filter volume down proportionally to prevent digital clipping on positive EQ boosts
    return Number(Math.max(0.55, 1.0 - maxPositive * 0.65).toFixed(3));
}

function getPresetConfig(presetKey = 'flat') {
    const key = PRESET_DEFINITIONS[presetKey] ? presetKey : 'flat';
    const def = PRESET_DEFINITIONS[key];
    return {
        key,
        label: def.label,
        bands: def.bands.map(b => ({ ...b })),
        filterVolume: computeHeadroomVolume(def.bands),
        lowPass: def.lowPass ? { ...def.lowPass } : null
    };
}

function buildLavalinkFilters(presetKey = 'flat') {
    const cfg = getPresetConfig(presetKey);
    return {
        volume: cfg.filterVolume,
        equalizer: cfg.bands,
        lowPass: cfg.lowPass
    };
}

function mapBassLevelToPreset(level) {
    switch (level) {
        case 'off':
        case 'flat':
            return 'flat';
        case 'low':
            return 'bass_low';
        case 'medium':
            return 'bass_medium';
        case 'high':
            return 'bass_high';
        case 'extreme':
            return 'bass_extreme';
        default:
            return 'flat';
    }
}

module.exports = {
    BAND_COUNT,
    PRESET_DEFINITIONS,
    getPresetConfig,
    buildLavalinkFilters,
    computeHeadroomVolume,
    mapBassLevelToPreset
};
