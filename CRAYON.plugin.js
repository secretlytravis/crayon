/**
 * @name CRAYON
 * @author Crayon
 * @version 0.1.0-alpha.3a
 * @description Crayon Regulates Audio for You Online, Nerds. Learns each person's comfortable volume and re-applies it automatically next time you hear them — not real-time loudness metering (Discord doesn't expose raw per-user audio to plugins), just persistent per-user gain.
 */

const PLUGIN_NAME = "CRAYON";
const DATA_KEY = "settings";
const DEFAULT_CONTEXT = "default";

const PRESETS = {
    balanced: { label: "Balanced", defaultGain: 100, minGain: 25, maxGain: 250 },
    boostQuiet: { label: "Boost quiet", defaultGain: 130, minGain: 25, maxGain: 300 },
    flattenLoud: { label: "Flatten loud", defaultGain: 90, minGain: 10, maxGain: 150 }
};

const DEFAULT_SETTINGS = {
    version: 1,
    global: {
        enabled: true, targetStyle: "balanced", minGain: 25, maxGain: 250, emaAlpha: 0.35, debugLogging: false,
        useDefaultOverride: false, defaultGainOverride: 100
    },
    users: {},
    guildOverrides: {}
};

const DEBUG_LOG_FILENAME = "crayon-debug.log";

const STYLE_CSS = `
.crayon-settings { padding: 8px 4px; color: var(--text-normal, #dcddde); }
.crayon-settings .cr-note { opacity: 0.75; font-size: 12px; margin-bottom: 12px; line-height: 1.4; }
.crayon-settings .cr-section { margin-bottom: 20px; padding-bottom: 4px; border-bottom: 1px solid var(--background-modifier-accent, #3f4147); }
.crayon-settings .cr-section:last-of-type { border-bottom: none; }
.crayon-settings .cr-section-header { font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.6; margin: 0 0 10px; }
.crayon-settings .cr-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.crayon-settings .cr-row label { flex: 1; }
.crayon-settings .cr-row input[type="number"]:disabled { opacity: 0.4; cursor: not-allowed; }
.crayon-settings .cr-range-wrap { display: flex; align-items: center; gap: 8px; }
.crayon-settings .cr-range-value { font-size: 12px; opacity: 0.75; min-width: 2.5em; text-align: right; }
.crayon-settings .cr-diagnostics { white-space: pre-wrap; font-family: monospace; font-size: 11px; background: var(--background-secondary, #2b2d31); padding: 8px; border-radius: 4px; margin-top: 8px; }
.crayon-settings .cr-table-wrap { margin-top: 16px; max-height: 260px; overflow-y: auto; }
.crayon-settings .cr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.crayon-settings .cr-table th, .crayon-settings .cr-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-accent, #3f4147); }
.crayon-settings .cr-buttons { display: flex; gap: 8px; margin-top: 12px; }
.crayon-settings .cr-button { background: var(--brand-experiment, #5865f2); color: #fff; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; margin-right: 6px; }
.crayon-settings .cr-button:last-child { margin-right: 0; }
.crayon-settings .cr-button:hover { opacity: 0.85; }
`;

// ---- Pure, unit-testable gain math (no BdApi references — safe to require() from plain Node) ----
const GainMath = {
    clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    },
    ema(previous, sample, alpha) {
        return previous * (1 - alpha) + sample * alpha;
    },
    learn(previousGain, manualSamples, newValue, alpha) {
        if (!manualSamples) return { gain: newValue, manualSamples: 1 };
        return { gain: GainMath.ema(previousGain, newValue, alpha), manualSamples: manualSamples + 1 };
    },
    // Average gain across users who've actually been manually calibrated (manualSamples > 0)
    // for this context — excludes entries still sitting at an untouched default, since folding
    // those in would create circular drift (averaging in values that were themselves just the
    // previous average/fallback). Returns null when nobody's been calibrated yet.
    averageCalibratedGain(settings, context) {
        const users = settings.users || {};
        const gains = Object.keys(users)
            .map(userId => users[userId] && users[userId][context])
            .filter(entry => entry && entry.manualSamples > 0)
            .map(entry => entry.gain);
        if (gains.length === 0) return null;
        return gains.reduce((sum, gain) => sum + gain, 0) / gains.length;
    },
    // The starting gain for someone not yet tracked: a fixed override if the user has turned
    // that on, otherwise the average of everyone already calibrated, otherwise a bootstrap
    // preset default for when there's no calibration data yet at all.
    computeDefaultGain(settings, context) {
        if (settings.global.useDefaultOverride && typeof settings.global.defaultGainOverride === "number") {
            return settings.global.defaultGainOverride;
        }
        const average = GainMath.averageCalibratedGain(settings, context);
        if (average !== null) return average;
        const preset = PRESETS[settings.global.targetStyle] || PRESETS.balanced;
        return preset.defaultGain;
    },
    resolveGain(settings, guildId, userId, context) {
        const guildEntry = settings.guildOverrides &&
            settings.guildOverrides[guildId] &&
            settings.guildOverrides[guildId][userId] &&
            settings.guildOverrides[guildId][userId][context];
        if (guildEntry && typeof guildEntry.gain === "number") return guildEntry.gain;

        const userEntry = settings.users && settings.users[userId] && settings.users[userId][context];
        if (userEntry && typeof userEntry.gain === "number") return userEntry.gain;

        return GainMath.computeDefaultGain(settings, context);
    }
};

function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function loadSettings() {
    const stored = BdApi.Data.load(PLUGIN_NAME, DATA_KEY);
    const merged = cloneDefaults();
    if (stored) {
        Object.assign(merged.global, stored.global);
        merged.users = stored.users || {};
        merged.guildOverrides = stored.guildOverrides || {};
    }
    return merged;
}

function saveSettings(settings) {
    BdApi.Data.save(PLUGIN_NAME, DATA_KEY, settings);
}

// Each core lookup tries multiple strategies in order, so a single Discord-side rename
// doesn't take the whole plugin down — this same list backs "Run diagnostics" in the
// settings panel, reporting which strategy actually resolved each module.
function coreModuleStrategies() {
    const { Filters, getModule } = BdApi.Webpack;
    // ES6 class methods are non-enumerable by spec, so key-enumeration filters (byKeys,
    // byPrototypeKeys) miss dispatch/subscribe if Dispatcher is a class instance on this
    // Discord build. A raw predicate checking property access sidesteps enumerability
    // entirely. searchExports also handles the instance being nested under a minified
    // export key rather than being the top-level module object itself.
    const isDispatcher = m => m && typeof m.dispatch === "function" && typeof m.subscribe === "function" && typeof m.unsubscribe === "function";
    // setLocalVolume(userId, volume, context) does its own internal perceptual<->amplitude
    // conversion before dispatching — the "volume" argument the UI passes (and that our
    // Patcher.after hook observes) is already the plain percentage, confirmed by reading its
    // decompiled source directly. No separate AudioConvert module is needed.
    const isMediaEngineActions = m => m && typeof m.setLocalVolume === "function";

    return {
        Dispatcher: [
            { name: "predicate", run: () => getModule(isDispatcher) },
            { name: "predicate+searchExports", run: () => getModule(isDispatcher, { searchExports: true }) }
        ],
        MediaEngineActions: [
            { name: "byKeys", run: () => getModule(Filters.byKeys("setLocalVolume")) },
            { name: "predicate+searchExports", run: () => getModule(isMediaEngineActions, { searchExports: true }) }
        ]
    };
}

function loadCoreModules() {
    const strategies = coreModuleStrategies();
    const modules = {};
    const strategyUsed = {};

    Object.keys(strategies).forEach(key => {
        for (const strategy of strategies[key]) {
            const found = strategy.run();
            if (found) {
                modules[key] = found;
                strategyUsed[key] = strategy.name;
                break;
            }
        }
    });

    const missing = Object.keys(strategies).filter(key => !modules[key]);
    if (missing.length > 0) return { modules: null, missing, strategyUsed };
    return { modules, missing: [], strategyUsed };
}

function loadOptionalModules() {
    const { Filters, getModule, getStore } = BdApi.Webpack;
    const optional = {};

    const tryGetStore = name => {
        try {
            if (typeof getStore === "function") {
                const store = getStore(name);
                if (store) return store;
            }
            return getModule(Filters.byDisplayName(name));
        } catch (e) {
            return null;
        }
    };

    optional.MediaEngineStore = tryGetStore("MediaEngineStore");
    optional.VoiceStateStore = tryGetStore("VoiceStateStore");
    optional.SelectedChannelStore = tryGetStore("SelectedChannelStore");
    optional.UserStore = tryGetStore("UserStore");

    return optional;
}

class CRAYON {
    start() {
        this.settings = loadSettings();
        this.currentlySpeaking = new Set();
        this.appliedThisSession = new Set();
        this.lastAppliedGain = new Map();
        this._applying = false;
        this._panelRefresh = null;

        this.lastSeenActionAt = {};

        const { modules, missing, strategyUsed } = loadCoreModules();
        if (!modules) {
            this.lastMissingCoreModules = missing;
            this.core = null;
            BdApi.UI.showToast(
                `${PLUGIN_NAME}: couldn't find Discord internals (${missing.join(", ")}) — Discord probably updated. Plugin disabled.`,
                { type: "error" }
            );
            return;
        }
        this.core = modules;
        this.coreStrategyUsed = strategyUsed;
        this.lastMissingCoreModules = [];
        this.optional = loadOptionalModules();

        this.debugLog("start", { optionalModulesFound: Object.keys(this.optional).filter(k => this.optional[k]), strategyUsed });

        // Everything past this point assumes the resolved modules behave exactly as expected
        // (right method signatures, patchable, subscribable) — none of that is guaranteed just
        // because the lookup succeeded, so any surprise here gets the same clear toast + debug
        // log treatment as a missing-module failure, instead of silently falling through to
        // whatever generic error handling BD itself provides.
        try {
            this.installDebugDispatchTap();

            this.unpatchSetLocalVolume = BdApi.Patcher.after(
                PLUGIN_NAME,
                this.core.MediaEngineActions,
                "setLocalVolume",
                (_this, args) => this.onSetLocalVolume(args)
            );

            this.onSpeaking = this.onSpeaking.bind(this);
            this.onVoiceStateUpdates = this.onVoiceStateUpdates.bind(this);
            this.core.Dispatcher.subscribe("SPEAKING", this.onSpeaking);
            this.core.Dispatcher.subscribe("VOICE_STATE_UPDATES", this.onVoiceStateUpdates);

            this.installContextMenuReset();
            this.seedFromCurrentChannel();
        } catch (e) {
            this.startupError = e;
            this.debugLog("startupError", { message: e && e.message, stack: e && e.stack });
            BdApi.UI.showToast(
                `${PLUGIN_NAME}: unexpected error during startup (${e && e.message}) — see Run Diagnostics in settings.`,
                { type: "error" }
            );
        }
    }

    stop() {
        if (this.unpatchSetLocalVolume) this.unpatchSetLocalVolume();
        if (this.core) {
            this.core.Dispatcher.unsubscribe("SPEAKING", this.onSpeaking);
            this.core.Dispatcher.unsubscribe("VOICE_STATE_UPDATES", this.onVoiceStateUpdates);
        }
        BdApi.Patcher.unpatchAll(PLUGIN_NAME);
        BdApi.DOM.removeStyle(PLUGIN_NAME);
    }

    // Debug logging — off by default, toggled from the settings panel. Writes newline-delimited
    // JSON to a log file next to the plugin (via BdApi.Plugins.folder, so it's portable across
    // machines). Kept as a permanent feature rather than throwaway diagnostics: Discord's internal
    // module names/action shapes have already shifted more than once during development, and
    // having a built-in way to see what's actually happening will save time next time something
    // breaks.
    //
    // Uses read-then-writeFileSync rather than appendFileSync: appendFileSync was found to fail
    // silently in the original development environment (likely AV/EDR blocking append-mode opens
    // from the Electron renderer), while writeFileSync works reliably.
    debugLog(event, data) {
        if (!this.settings || !this.settings.global.debugLogging) return;
        try {
            const fs = require("fs");
            const path = require("path").join(BdApi.Plugins.folder, DEBUG_LOG_FILENAME);
            let existingLines = [];
            try {
                existingLines = fs.readFileSync(path, "utf8").split("\n").filter(Boolean);
            } catch (e) {
                existingLines = [];
            }
            existingLines.push(JSON.stringify({ time: new Date().toISOString(), event, ...data }));
            if (existingLines.length > 500) existingLines = existingLines.slice(-500);
            fs.writeFileSync(path, existingLines.join("\n") + "\n");
        } catch (e) { /* logging must never break the plugin itself */ }
    }

    // Taps every dispatched action matching voice/speaking-related types and logs it when debug
    // logging is on — this is how the real SPEAKING/VOICE_STATE_UPDATES shapes were discovered.
    installDebugDispatchTap() {
        this.unpatchDebugDispatchTap = BdApi.Patcher.before(PLUGIN_NAME, this.core.Dispatcher, "dispatch", (_this, args) => {
            const action = args[0];
            if (action && typeof action.type === "string" && /SPEAK|VOICE_STATE|VOICE_CHANNEL/i.test(action.type)) {
                // Always tracked in memory (regardless of the Debug Logging setting) so
                // "Run diagnostics" always has something concrete to report — this is the
                // cheapest possible signal that the events the plugin depends on are still
                // actually firing under their expected names.
                this.lastSeenActionAt[action.type] = Date.now();
                this.debugLog("dispatch", { action });
            }
        });
    }

    // ---- Core algorithm ----

    onSetLocalVolume(args) {
        if (this._applying) return; // ignore our own writes, only learn from the user's own manual rides
        const [userId, percent, context] = args || [];
        if (typeof userId !== "string" && typeof userId !== "number") return;
        if (typeof percent !== "number" || Number.isNaN(percent)) return;
        try {
            this.onManualRide(String(userId), context || DEFAULT_CONTEXT, percent);
        } catch (e) {
            BdApi.Logger.warn(PLUGIN_NAME, "failed to process manual volume ride", e);
        }
    }

    onManualRide(userId, context, percent) {
        if (!this.settings.global.enabled) return;
        const bucket = this.settings.users[userId] || (this.settings.users[userId] = {});
        const entry = bucket[context] || { gain: GainMath.computeDefaultGain(this.settings, context), manualSamples: 0, lastManualAt: null, locked: false };

        if (entry.locked) {
            this.debugLog("manualRideIgnoredLocked", { userId, context, percent });
            return; // frozen — ignore further manual rides until explicitly unlocked
        }

        const learned = GainMath.learn(entry.gain, entry.manualSamples, percent, this.settings.global.emaAlpha);
        bucket[context] = {
            gain: GainMath.clamp(learned.gain, this.settings.global.minGain, this.settings.global.maxGain),
            manualSamples: learned.manualSamples,
            lastManualAt: Date.now(),
            locked: false
        };

        saveSettings(this.settings);
        this.debugLog("manualRide", { userId, context, percent, learnedGain: bucket[context].gain, manualSamples: bucket[context].manualSamples });
        this.refreshPanel();
    }

    applyGain(userId, context, guildId) {
        if (!this.core || this.isUserMuted(userId)) return;

        const gain = GainMath.resolveGain(this.settings, guildId, userId, context);
        this.ensureTracked(userId, context, gain);

        const key = `${userId}:${context}`;
        if (this.appliedThisSession.has(key) && this.lastAppliedGain.get(key) === gain) return;

        this.applyGainDirect(userId, context, gain);
        this.appliedThisSession.add(key);
        this.lastAppliedGain.set(key, gain);
    }

    // Adds a table entry the first time we resolve/apply a gain for someone not yet tracked
    // (e.g. discovered via SPEAKING/VOICE_STATE_UPDATES) — so the table reflects who the plugin
    // is actively managing, not just people who've had their slider manually ridden.
    ensureTracked(userId, context, gain) {
        const bucket = this.settings.users[userId] || (this.settings.users[userId] = {});
        if (bucket[context]) return;
        bucket[context] = { gain, manualSamples: 0, lastManualAt: null, locked: false };
        saveSettings(this.settings);
        this.refreshPanel();
    }

    applyGainDirect(userId, context, gain) {
        if (!this.core) return;
        this._applying = true;
        let error = null;
        try {
            this.core.MediaEngineActions.setLocalVolume(userId, gain, context);
        } catch (e) {
            error = e;
            BdApi.Logger.warn(PLUGIN_NAME, "failed to apply gain", e);
        } finally {
            this._applying = false;
        }

        if (this.settings.global.debugLogging) {
            let storeValueAfter = null;
            try {
                storeValueAfter = this.optional.MediaEngineStore &&
                    this.optional.MediaEngineStore.getLocalVolume &&
                    this.optional.MediaEngineStore.getLocalVolume(userId, context);
            } catch (e) {
                storeValueAfter = `ERR:${e.message}`;
            }
            this.debugLog("applyGain", {
                userId, context, gainWeSet: gain,
                error: error ? (error.message || String(error)) : null,
                storeValueAfter
            });
        }
    }

    isUserMuted(userId) {
        try {
            const vs = this.optional.VoiceStateStore &&
                this.optional.VoiceStateStore.getVoiceStateForUser &&
                this.optional.VoiceStateStore.getVoiceStateForUser(userId);
            return !!(vs && (vs.mute || vs.selfMute || vs.deaf || vs.selfDeaf));
        } catch (e) {
            return false;
        }
    }

    currentGuildId() {
        try {
            return (this.optional.SelectedChannelStore &&
                this.optional.SelectedChannelStore.getGuildId &&
                this.optional.SelectedChannelStore.getGuildId()) || null;
        } catch (e) {
            return null;
        }
    }

    currentVoiceChannelId() {
        try {
            return (this.optional.SelectedChannelStore &&
                this.optional.SelectedChannelStore.getVoiceChannelId &&
                this.optional.SelectedChannelStore.getVoiceChannelId()) || null;
        } catch (e) {
            return null;
        }
    }

    myUserId() {
        try {
            const me = this.optional.UserStore && this.optional.UserStore.getCurrentUser && this.optional.UserStore.getCurrentUser();
            return me && me.id ? String(me.id) : null;
        } catch (e) {
            return null;
        }
    }

    // Discord's Dispatcher is global — SPEAKING/VOICE_STATE_UPDATES fire for channels you're
    // merely previewing (stage channels, large-server activity, friends'-activity indicators),
    // not just the call you're actually in. Without this check the plugin would track and apply
    // gain to people you've never actually shared a voice channel with.
    isUserInMyChannel(userId) {
        try {
            const myChannelId = this.currentVoiceChannelId();
            if (!myChannelId) return false;
            const vs = this.optional.VoiceStateStore &&
                this.optional.VoiceStateStore.getVoiceStateForUser &&
                this.optional.VoiceStateStore.getVoiceStateForUser(userId);
            return !!(vs && vs.channelId === myChannelId);
        } catch (e) {
            return false;
        }
    }

    onSpeaking(event) {
        if (!event || !event.userId) return;
        const userId = String(event.userId);
        const speaking = !!(event.speakingFlags || event.soundshare);
        if (speaking) this.currentlySpeaking.add(userId); else this.currentlySpeaking.delete(userId);
        if (speaking && this.settings.global.enabled && userId !== this.myUserId() && this.isUserInMyChannel(userId)) {
            this.applyGain(userId, DEFAULT_CONTEXT, this.currentGuildId());
        }
        this.refreshPanel();
    }

    onVoiceStateUpdates(event) {
        if (!event || !Array.isArray(event.voiceStates)) return;
        const guildId = event.guildId || this.currentGuildId();
        const myChannelId = this.currentVoiceChannelId();
        const myUserId = this.myUserId();
        for (const state of event.voiceStates) {
            if (!state || !state.userId) continue;
            const userId = String(state.userId);
            if (state.channelId) {
                if (this.settings.global.enabled && userId !== myUserId && myChannelId && state.channelId === myChannelId) {
                    this.applyGain(userId, DEFAULT_CONTEXT, guildId);
                }
            } else {
                this.currentlySpeaking.delete(userId);
            }
        }
        this.refreshPanel();
    }

    seedFromCurrentChannel() {
        try {
            const channelId = this.optional.SelectedChannelStore &&
                this.optional.SelectedChannelStore.getVoiceChannelId &&
                this.optional.SelectedChannelStore.getVoiceChannelId();
            if (!channelId || !this.optional.VoiceStateStore || !this.optional.VoiceStateStore.getVoiceStatesForChannel) return;
            const states = this.optional.VoiceStateStore.getVoiceStatesForChannel(channelId);
            if (!states) return;
            const guildId = this.currentGuildId();
            const myUserId = this.myUserId();
            Object.keys(states).forEach(userId => {
                if (this.settings.global.enabled && userId !== myUserId) this.applyGain(userId, DEFAULT_CONTEXT, guildId);
            });
            this.refreshPanel();
        } catch (e) {
            BdApi.Logger.warn(PLUGIN_NAME, "failed to seed from current channel", e);
        }
    }

    installContextMenuReset() {
        try {
            this.unpatchContextMenu = BdApi.ContextMenu.patch("user-context", (returnValue, props) => {
                const userId = props && props.user && props.user.id;
                const entry = userId && this.settings.users[userId] && this.settings.users[userId][DEFAULT_CONTEXT];
                if (!entry) return;
                returnValue.props.children.push(
                    BdApi.ContextMenu.buildItem({
                        label: entry.locked ? "Unlock auto-gain for this user" : "Lock auto-gain for this user",
                        action: () => this.toggleLock(userId)
                    }),
                    BdApi.ContextMenu.buildItem({
                        label: "Reset auto-gain for this user",
                        action: () => this.resetUser(userId)
                    })
                );
            });
        } catch (e) {
            BdApi.Logger.warn(PLUGIN_NAME, "skipping context menu item (best-effort UI only)", e);
        }
    }

    resetUser(userId) {
        delete this.settings.users[userId];
        saveSettings(this.settings);
        this.applyGainDirect(userId, DEFAULT_CONTEXT, GainMath.computeDefaultGain(this.settings, DEFAULT_CONTEXT));
        this.appliedThisSession.delete(`${userId}:${DEFAULT_CONTEXT}`);
        this.refreshPanel();
    }

    toggleLock(userId, context = DEFAULT_CONTEXT) {
        const entry = this.settings.users[userId] && this.settings.users[userId][context];
        if (!entry) return;
        entry.locked = !entry.locked;
        saveSettings(this.settings);
        this.refreshPanel();
    }

    resetAllToDefault() {
        Object.keys(this.settings.users).forEach(userId => {
            this.applyGainDirect(userId, DEFAULT_CONTEXT, 100);
        });
        this.settings.users = {};
        this.settings.guildOverrides = {};
        saveSettings(this.settings);
        this.appliedThisSession.clear();
        this.lastAppliedGain.clear();
        this.refreshPanel();
    }

    clearLearnedData() {
        this.settings.users = {};
        this.settings.guildOverrides = {};
        saveSettings(this.settings);
        this.appliedThisSession.clear();
        this.lastAppliedGain.clear();
        this.refreshPanel();
    }

    // ---- Settings panel (vanilla DOM — no dependency on a specific BdApi UI-builder version) ----

    getSettingsPanel() {
        BdApi.DOM.addStyle(PLUGIN_NAME, STYLE_CSS);
        const container = document.createElement("div");
        container.className = "crayon-settings";

        if (!this.core) {
            const failNote = document.createElement("p");
            failNote.className = "cr-note";
            const missingList = (this.lastMissingCoreModules || []).join(", ") || "unknown";
            failNote.textContent = `CRAYON failed to start — couldn't resolve: ${missingList}. Discord likely updated and one of the plugin's internal lookups needs adjusting.`;
            container.appendChild(failNote);

            const diagnosticsBlock = document.createElement("pre");
            diagnosticsBlock.className = "cr-diagnostics";
            diagnosticsBlock.textContent = this.formatDiagnosticsText(this.runDiagnostics());
            container.appendChild(this.buildButton("Run diagnostics", () => {
                diagnosticsBlock.textContent = this.formatDiagnosticsText(this.runDiagnostics());
            }));
            container.appendChild(diagnosticsBlock);
            return container;
        }

        const note = document.createElement("p");
        note.className = "cr-note";
        note.textContent = "This learns the volume you've already dialed in for each person and re-applies it automatically. It does not measure loudness in real time — Discord Desktop doesn't expose raw per-user audio to plugins. Lock a user (below, or via their right-click menu) once they're where you want them, to stop further manual adjustments from changing their learned gain.";
        container.appendChild(note);

        // ---- General ----
        const generalSection = this.buildSection("General");
        generalSection.appendChild(this.buildRow("Enabled", this.buildCheckbox(this.settings.global.enabled, value => {
            this.settings.global.enabled = value;
            saveSettings(this.settings);
        })));
        container.appendChild(generalSection);

        // ---- Default gain for new people ----
        const defaultGainSection = this.buildSection("Default gain for new people");

        defaultGainSection.appendChild(this.buildRow("Target style", this.buildSelect(
            Object.keys(PRESETS).map(key => ({ value: key, label: PRESETS[key].label })),
            this.settings.global.targetStyle,
            value => {
                this.settings.global.targetStyle = value;
                saveSettings(this.settings);
                this.refreshPanel();
            }
        )));
        const targetStyleNote = document.createElement("p");
        targetStyleNote.className = "cr-note";
        targetStyleNote.textContent = "Only used as a bootstrap starting point before anyone's been calibrated yet — the average below takes over once you have real data.";
        defaultGainSection.appendChild(targetStyleNote);

        const overrideValueInput = this.buildNumber(this.settings.global.defaultGainOverride, value => {
            this.settings.global.defaultGainOverride = value;
            saveSettings(this.settings);
            this.refreshPanel();
        }, !this.settings.global.useDefaultOverride);

        defaultGainSection.appendChild(this.buildRow("Override with a fixed value", this.buildCheckbox(this.settings.global.useDefaultOverride, value => {
            this.settings.global.useDefaultOverride = value;
            overrideValueInput.disabled = !value;
            saveSettings(this.settings);
            this.refreshPanel();
        })));
        defaultGainSection.appendChild(this.buildRow("Override value %", overrideValueInput));

        const defaultGainInfo = document.createElement("p");
        defaultGainInfo.className = "cr-note";
        defaultGainSection.appendChild(defaultGainInfo);

        container.appendChild(defaultGainSection);

        // ---- Advanced ----
        const advancedSection = this.buildSection("Advanced");
        advancedSection.appendChild(this.buildRow("Min gain %", this.buildNumber(this.settings.global.minGain, value => {
            this.settings.global.minGain = value;
            saveSettings(this.settings);
        })));
        advancedSection.appendChild(this.buildRow("Max gain %", this.buildNumber(this.settings.global.maxGain, value => {
            this.settings.global.maxGain = value;
            saveSettings(this.settings);
        })));
        advancedSection.appendChild(this.buildRow("Learning speed (α)", this.buildRange(0.1, 0.8, 0.05, this.settings.global.emaAlpha, value => {
            this.settings.global.emaAlpha = value;
            saveSettings(this.settings);
        })));
        container.appendChild(advancedSection);

        // ---- Tracked users ----
        const trackedSection = this.buildSection("Tracked users");
        const tableWrap = document.createElement("div");
        tableWrap.className = "cr-table-wrap";
        trackedSection.appendChild(tableWrap);
        this._panelRefresh = () => {
            this.renderTable(tableWrap);
            this.renderDefaultGainInfo(defaultGainInfo);
        };
        this.renderTable(tableWrap);
        this.renderDefaultGainInfo(defaultGainInfo);

        const buttonRow = document.createElement("div");
        buttonRow.className = "cr-buttons";
        buttonRow.appendChild(this.buildButton("Reset all to 100%", () => this.resetAllToDefault()));
        buttonRow.appendChild(this.buildButton("Clear learned data", () => this.clearLearnedData()));
        trackedSection.appendChild(buttonRow);
        container.appendChild(trackedSection);

        // ---- Debugging ----
        const debugSection = this.buildSection("Debugging");
        debugSection.appendChild(this.buildRow("Debug logging", this.buildCheckbox(this.settings.global.debugLogging, value => {
            this.settings.global.debugLogging = value;
            saveSettings(this.settings);
        })));
        const debugNote = document.createElement("p");
        debugNote.className = "cr-note";
        debugNote.textContent = `When on, writes ${DEBUG_LOG_FILENAME} next to this plugin file (manual rides, apply attempts, and voice/speaking dispatch events) — useful if something breaks after a Discord update and you need to see what's actually happening.`;
        debugSection.appendChild(debugNote);

        const diagnosticsNote = document.createElement("p");
        diagnosticsNote.className = "cr-note";
        diagnosticsNote.textContent = "If something seems broken after a Discord update, start here — it re-checks the plugin's internal lookups live and shows when it last saw the events it depends on.";
        debugSection.appendChild(diagnosticsNote);

        const diagnosticsBlock = document.createElement("pre");
        diagnosticsBlock.className = "cr-diagnostics";
        diagnosticsBlock.textContent = this.formatDiagnosticsText(this.runDiagnostics());
        debugSection.appendChild(this.buildButton("Run diagnostics", () => {
            diagnosticsBlock.textContent = this.formatDiagnosticsText(this.runDiagnostics());
        }));
        debugSection.appendChild(diagnosticsBlock);

        container.appendChild(debugSection);

        return container;
    }

    buildSection(title) {
        const section = document.createElement("div");
        section.className = "cr-section";
        const header = document.createElement("h3");
        header.className = "cr-section-header";
        header.textContent = title;
        section.appendChild(header);
        return section;
    }

    refreshPanel() {
        if (this._panelRefresh) this._panelRefresh();
    }

    renderDefaultGainInfo(el) {
        if (this.settings.global.useDefaultOverride) {
            el.textContent = `New people currently start at ${Math.round(this.settings.global.defaultGainOverride)}% (fixed override).`;
            return;
        }
        const average = GainMath.averageCalibratedGain(this.settings, DEFAULT_CONTEXT);
        if (average !== null) {
            el.textContent = `New people currently start at ${Math.round(average)}% — the average of everyone you've manually calibrated so far.`;
        } else {
            const preset = PRESETS[this.settings.global.targetStyle] || PRESETS.balanced;
            el.textContent = `New people currently start at ${preset.defaultGain}% (${preset.label} preset) — no one's been manually calibrated yet.`;
        }
    }

    renderTable(container) {
        container.innerHTML = "";
        const table = document.createElement("table");
        table.className = "cr-table";
        const thead = document.createElement("thead");
        thead.innerHTML = "<tr><th>User</th><th>Learned gain</th><th>Samples</th><th>Status</th><th></th></tr>";
        table.appendChild(thead);
        const tbody = document.createElement("tbody");

        const userIds = Object.keys(this.settings.users);
        if (userIds.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = "<td colspan=\"5\">No one tracked yet — join a call or adjust someone's volume slider.</td>";
            tbody.appendChild(row);
        }

        userIds.forEach(userId => {
            const entry = this.settings.users[userId][DEFAULT_CONTEXT];
            if (!entry) return;
            const row = document.createElement("tr");

            const nameCell = document.createElement("td");
            nameCell.textContent = this.displayNameFor(userId);
            row.appendChild(nameCell);

            const gainCell = document.createElement("td");
            gainCell.textContent = `${Math.round(entry.gain)}%`;
            row.appendChild(gainCell);

            const samplesCell = document.createElement("td");
            samplesCell.textContent = String(entry.manualSamples || 0);
            row.appendChild(samplesCell);

            const statusCell = document.createElement("td");
            const speakingText = this.currentlySpeaking.has(userId) ? "speaking" : "idle";
            statusCell.textContent = entry.locked ? `${speakingText} · locked` : speakingText;
            row.appendChild(statusCell);

            const actionsCell = document.createElement("td");
            actionsCell.appendChild(this.buildButton(entry.locked ? "Unlock" : "Lock", () => this.toggleLock(userId)));
            actionsCell.appendChild(this.buildButton("Reset", () => this.resetUser(userId)));
            row.appendChild(actionsCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    }

    displayNameFor(userId) {
        try {
            const user = this.optional.UserStore && this.optional.UserStore.getUser && this.optional.UserStore.getUser(userId);
            return (user && (user.globalName || user.username)) || userId;
        } catch (e) {
            return userId;
        }
    }

    pluginVersion() {
        try {
            const addon = BdApi.Plugins.get(PLUGIN_NAME);
            return (addon && addon.version) || "unknown";
        } catch (e) {
            return "unknown";
        }
    }

    // Re-checks module resolution live (rather than reusing whatever start() found once) and
    // reports it alongside last-seen dispatch timestamps — the goal is that if Discord breaks
    // something, opening settings and clicking this tells you exactly what, immediately,
    // instead of the multi-step toast/DevTools/log investigation this plugin's own webpack
    // lookups originally needed.
    runDiagnostics() {
        const { missing, strategyUsed } = loadCoreModules();
        const now = Date.now();
        const formatAge = ts => {
            const ageMs = now - ts;
            if (ageMs < 60000) return `${Math.round(ageMs / 1000)}s ago`;
            if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}m ago`;
            return `${Math.round(ageMs / 3600000)}h ago`;
        };
        const lastSeenActions = {};
        Object.keys(this.lastSeenActionAt || {}).forEach(type => {
            lastSeenActions[type] = formatAge(this.lastSeenActionAt[type]);
        });

        return {
            version: this.pluginVersion(),
            coreModules: Object.keys(coreModuleStrategies()).map(name => ({
                name,
                resolved: !missing.includes(name),
                strategy: strategyUsed[name] || null
            })),
            optionalModules: this.optional ? Object.keys(this.optional).map(name => ({ name, resolved: !!this.optional[name] })) : [],
            lastSeenActions,
            startupError: this.startupError ? (this.startupError.message || String(this.startupError)) : null
        };
    }

    formatDiagnosticsText(result) {
        const lines = [];
        lines.push(`CRAYON ${result.version}`);
        lines.push("");
        lines.push("Core modules:");
        result.coreModules.forEach(m => {
            lines.push(`  ${m.resolved ? "✓" : "✗"} ${m.name}${m.strategy ? ` (via ${m.strategy})` : ""}`);
        });
        lines.push("");
        lines.push("Optional modules:");
        if (result.optionalModules.length === 0) {
            lines.push("  (not loaded — core modules failed before optional lookups ran)");
        } else {
            result.optionalModules.forEach(m => lines.push(`  ${m.resolved ? "✓" : "✗"} ${m.name}`));
        }
        lines.push("");
        lines.push("Last seen dispatch events:");
        const seenTypes = Object.keys(result.lastSeenActions);
        if (seenTypes.length === 0) {
            lines.push("  (none yet this session)");
        } else {
            seenTypes.forEach(type => lines.push(`  ${type}: ${result.lastSeenActions[type]}`));
        }
        if (result.startupError) {
            lines.push("");
            lines.push(`Startup error: ${result.startupError}`);
        }
        return lines.join("\n");
    }

    // ---- tiny vanilla-DOM helpers ----

    buildRow(labelText, control) {
        const row = document.createElement("div");
        row.className = "cr-row";
        const label = document.createElement("label");
        label.textContent = labelText;
        row.appendChild(label);
        row.appendChild(control);
        return row;
    }

    buildCheckbox(checked, onChange) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked;
        input.addEventListener("change", () => onChange(input.checked));
        return input;
    }

    buildSelect(options, value, onChange) {
        const select = document.createElement("select");
        options.forEach(opt => {
            const el = document.createElement("option");
            el.value = opt.value;
            el.textContent = opt.label;
            if (opt.value === value) el.selected = true;
            select.appendChild(el);
        });
        select.addEventListener("change", () => onChange(select.value));
        return select;
    }

    buildNumber(value, onChange, disabled = false) {
        const input = document.createElement("input");
        input.type = "number";
        input.value = value;
        input.disabled = disabled;
        input.addEventListener("change", () => onChange(Number(input.value)));
        return input;
    }

    buildRange(min, max, step, value, onChange) {
        const wrap = document.createElement("div");
        wrap.className = "cr-range-wrap";
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        const valueLabel = document.createElement("span");
        valueLabel.className = "cr-range-value";
        valueLabel.textContent = String(value);
        input.addEventListener("input", () => { valueLabel.textContent = input.value; });
        input.addEventListener("change", () => onChange(Number(input.value)));
        wrap.appendChild(input);
        wrap.appendChild(valueLabel);
        return wrap;
    }

    buildButton(text, onClick) {
        const button = document.createElement("button");
        button.textContent = text;
        button.className = "cr-button";
        button.addEventListener("click", onClick);
        return button;
    }
}

CRAYON.GainMath = GainMath; // exposed for unit tests only; BD only uses the default class export

module.exports = CRAYON;
