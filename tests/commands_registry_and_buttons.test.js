const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const interactionCreate = require('../src/events/interactionCreate');
const { buildControlRows } = require('../src/utils/embedBuilder');

describe('Command Registry & Interactive Button Controls', () => {
    it('loads all 28 slash commands with valid Discord builder schemas and execute handlers', () => {
        const commandsDir = path.join(__dirname, '..', 'src', 'commands');
        const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
        const names = new Set();

        for (const file of files) {
            const cmd = require(path.join(commandsDir, file));
            assert.ok(cmd.data, `${file} missing .data`);
            assert.equal(typeof cmd.execute, 'function', `${file} missing .execute`);
            const json = cmd.data.toJSON();
            assert.ok(json.name, `${file} missing command name`);
            assert.ok(!names.has(json.name), `Duplicate command name: ${json.name}`);
            names.add(json.name);
        }

        const required = [
            'play', 'search', 'artist', 'pause', 'resume', 'skip', 'previous',
            'stop', 'disconnect', 'queue', 'nowplaying', 'loop', 'shuffle',
            'move', 'remove', 'volume', 'seek', 'bassboost', 'equalizer',
            'autoplay', 'clear', '247', 'lyrics', 'help', 'ping', 'stats',
            'settings', 'playlist'
        ];
        for (const reqName of required) {
            assert.ok(names.has(reqName), `Missing required command /${reqName}`);
        }
    });

    it('renders 2 rows x 5 buttons = 10 controls within Discord limits and handles stale sessions', async () => {
        const rows = buildControlRows({ isPaused: false, loop: 'none', autoplay: false, sessionId: 'sess1' }, false);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].components.length, 5);
        assert.equal(rows[1].components.length, 5);

        let updatedPayload = null;
        const staleInteraction = {
            isButton: () => true,
            isChatInputCommand: () => false,
            customId: 'music_skip:old_session',
            guildId: 'g1',
            user: { id: 'u1' },
            message: { id: 'm1' },
            member: { voice: { channelId: 'v1' } },
            update: async (payload) => { updatedPayload = payload; },
            reply: async () => {}
        };

        const client = {
            manager: {
                getPlayer: () => ({
                    sessionId: 'new_session',
                    isDestroyed: () => false
                })
            }
        };

        await interactionCreate.execute(staleInteraction, client);
        assert.ok(updatedPayload, 'Stale control button should disable components via interaction.update');
        assert.equal(updatedPayload.components[0].components[0].data.disabled, true);
    });
});
