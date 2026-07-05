# CRAYON 🖍️

*(**C**rayon **R**egulates **A**udio for **Y**ou **O**nline **N**erds. Yes, it is a GNU-style joke acronym. No, we are not sorry.)*

**v0.1.0-alpha.3a**
A BetterDiscord plugin

## Coming to you live

GOOD EVENING, INTERNET PEOPLE.

This is your man **Crayon**, coming to you today with a brand-new product available now, tomorrow, and until the eschaton, for the low, low price of **free ninety-nine**.

That is right. Free. No payments. No subscription. No three-day trial that turns into a monthly blood pact. Just one little BetterDiscord plugin trying to make your voice chats slightly less cursed.

You know the scene. One friend talks like he is sharing state secrets in a library. Another friend comes in hot enough to wake the neighbors, the pets, and possibly a few minor Old Testament prophets. Meanwhile, you are riding Discord volume sliders all night like you got hired to run sound at a youth conference.

CRAYON says, "No more, beloved."

CRAYON remembers how loud you like people. You adjust a person once, and CRAYON quietly writes it down. Next call, next day, next Discord restart, CRAYON puts that volume slider right back where you left it.

Not magic. Not sorcery. Not even advanced wizardry. Just memory, manners, and a strong commitment to keeping your friends at a reasonable volume.

## The honest part, because we are not selling snake oil today

Now listen closely, caller number nine.

Here is the thing nobody tells you about Discord plugins: **there is no magic button that measures how loud your friend actually is.**

Discord Desktop runs its voice engine in native C++ code, and it does not hand raw audio over to BetterDiscord plugins. Not this plugin. Not another plugin. Not some secret shadow plugin living behind the curtain. Nobody gets that audio unless they rebuild the whole Discord audio pipeline from the ground up.

So CRAYON is not secretly running a compressor, limiter, mastering chain, studio rack, or forbidden broadcast console on your friends' voices.

It cannot.

Nobody can.

What CRAYON actually does is much simpler, and frankly, a little charming. It remembers.

Every time you drag someone's native Discord volume slider, CRAYON takes note. It smooths the value a little, so one accidental slider slap does not erase weeks of careful tuning. Then, when that person shows up again, CRAYON puts their slider back where you trained it to be.

You do the calibration once. CRAYON does the remembering.

Think of it less like a sound engineer and more like a very attentive assistant standing beside the board saying, "Brother, I remember this guy. He goes at 72 percent."

## A quick word from our safety department

Discord has internal "who is talking" events, but those events are global to the whole client. That means stage-channel previews, busy servers, and random activity can leak voice events for people who are not actually in your current call.

CRAYON checks that the voice event belongs to **your current voice channel** and that the person is **not you** before it tracks or touches anything.

That means you should not end up with your neighbor's cousin's gamer tag in your settings panel.

Was this a real bug? Yes.

Was it found the hard way by a deeply confused user? Also yes.

Is it fixed now? You better believe it.

You are welcome.

## Step zero: you need BetterDiscord first

CRAYON is not a Discord feature. It is not an official anything. It is a
plugin, and plugins need a plugin loader, and the plugin loader in question
is called **BetterDiscord**.

Already have it? Already see a "BETTERDISCORD" section sitting in your
Discord settings? Skip this whole section and go make yourself a sandwich.

Do not have it yet? Here is the drill:

1. Go to [betterdiscord.app](https://betterdiscord.app) and download the installer for your operating system.
2. Run it. It will find your Discord installation on its own, like a bloodhound that only cares about Electron apps.
3. Let it install, then fully quit and reopen Discord. Closing it from the system tray or task manager, is the safe move here.
4. Open Discord settings. See a new **BETTERDISCORD** section in the sidebar, with its own Plugins, Themes, and Custom CSS pages? You are in.

A quick word of honesty, because that is the whole personality of this
README: BetterDiscord is an unofficial client modification. Discord did not
make it, Discord has not blessed it, and strictly speaking it lives outside
what Discord's terms of service want you doing to their client. In practice
it is extremely widely used and nobody is kicking down doors over it, but
"extremely popular" and "officially endorsed" are two different sentences.
Go in with your eyes open.

Once BetterDiscord is running, come back here and keep reading.

## Now, the actual plugin

Drop `CRAYON.plugin.js` into your BetterDiscord plugins folder.

On Windows, that is usually:

```txt
%appdata%\BetterDiscord\plugins
```

Then reload Discord with:

```txt
Ctrl+R
```

Or flip the toggle in:

```txt
Settings > BetterDiscord > Plugins
```

And that is it.

No build step. No dependencies. No npm install. No node_modules folder so large it develops its own weather system.

One file.

Drop it in.

Turn it on.

Let the crayon color inside the audio lines.

## Settings, explained like a person with a microphone

### Enabled

This is the big on/off switch.

Turn it on when you want CRAYON to handle the remembering. Turn it off when you want to experience voice chat the way the universe intended, which is apparently chaos.

### Default gain for new people

The first time CRAYON hears someone new, it needs a starting point.

Instead of throwing a dart at the wall, CRAYON averages the people you have actually calibrated so far. People you have never touched do not count, because that would just be the plugin agreeing with itself in an echo chamber.

There is a live line in settings telling you exactly what number it is using and why, because mystery is for theology and murder novels, not volume sliders.

### Override with a fixed value

Would you rather pick the default yourself?

Check the box. Set the number. CRAYON stops averaging and does what you say.

Like a good assistant should.

### Target style

This only matters before you have calibrated anyone at all.

Fresh install. Day one. Empty memory. Nobody in the books yet.

Your options are:

```txt
Balanced: 100%
Boost quiet: 130%
Flatten loud: 90%
```

Once CRAYON has real data, your learned average takes over and this setting becomes background trivia.

### Min/Max gain %

These are the safety rails.

No matter how confident the math gets, nobody gets launched into the sun or buried underground. CRAYON keeps volume inside the range you allow.

### Learning speed, also known as alpha

This controls how quickly CRAYON updates its memory when you adjust someone.

Higher alpha means CRAYON trusts your latest slider move quickly.

Lower alpha means CRAYON takes its time and averages across several adjustments before committing.

There is a live number next to the slider now, because making people guess what alpha means from a lonely little bar is cruel and unusual interface design.

### Run diagnostics

This is the "is this thing on?" button.

If Discord updates and something feels wrong, click **Run Diagnostics** first.

It checks the plugin live and tells you, in plain text, what is working and what is not. It also tells you how long ago it last saw someone speak, even if Debug logging was never turned on.

This exists because one debugging session took several hours of blind guessing to find what had actually broken, and nobody should have to go through that again.

Not in this economy.

### Debug logging

Off by default.

Why? Because most people do not want a plugin quietly journaling voice-chat activity to disk like it is writing memoirs.

Turn it on only when something is broken and diagnostics are not enough.

When enabled, it writes a plain-text log called:

```txt
crayon-debug.log
```

That log lives next to the plugin file and records things like manual adjustments, apply attempts, and the underlying Discord events.

### The tracked-people table

The moment CRAYON hears or sees someone join, they show up here.

New people start at the computed default with zero samples, so you can watch CRAYON learn in real time.

Each row has two big useful buttons.

**Lock** freezes that person's volume. CRAYON ignores future slider drags for them. This is excellent for the one friend who occasionally bumps their mic gain and would otherwise trick the plugin into learning bad habits.

**Reset** wipes just that person and lets you start over.

### Reset all to 100% / Clear learned data

These are the nuclear options.

**Reset all to 100%** actually sets everyone's Discord volume back to 100%.

**Clear learned data** clears CRAYON's memory without touching the volumes currently set.

Use with wisdom. Use with confidence. Use knowing there is no undo button from the heavens.

### Right-click shortcuts

Right-click anyone CRAYON is tracking and you can Lock, Unlock, or Reset them directly from the context menu.

Because sometimes opening the full settings panel feels like filing paperwork.

## Where things actually stand

Live-verified and working for real:

```txt
Clean loading
Manual slider learning
Auto-reapply on join and speak
Auto-discovery table
Lock and Unlock
Reset buttons
Clear buttons
Run Diagnostics
```

The volume reapply behavior has been checked byte-for-byte against Discord's own internal volume store. Not just "seems right." Actually matched.

That is the kind of boring confidence we like around here.

## Not yet personally witnessed

Mute/deafen skip-and-resume.

The logic is there. The reasoning is sound. It just has not been watched happen live yet.

If you are testing this for the first time, the two most helpful things to check are:

```txt
1. Mute or deafen someone CRAYON is tracking.
2. Confirm CRAYON stops adjusting them but keeps their learned volume.
3. Unmute or undeafen them.
4. Confirm CRAYON resumes.
```

Also report your Discord client version if something breaks, because this plugin works by peeking at Discord's internal, unofficial structure. That is the one axis where things are genuinely fragile.

## A permanent truth about this plugin

Let us speak plainly from the broadcast booth.

The following Discord internals are not public promises:

```txt
Dispatcher
MediaEngineActions
SPEAKING
VOICE_STATE_UPDATES
```

Discord never promised to keep these stable. CRAYON peeks at them anyway because that is the only way this works.

Every one of them has already changed shape at least once during development.

So when Discord updates and something inevitably breaks, do not panic. Open settings, click **Run Diagnostics**, and let CRAYON tell you what went sideways.

This is the price of living on the frontier.

## Running the boring-but-important tests

The core gain math lives in a plain `GainMath` object with zero Discord dependencies.

That includes:

```txt
Averaging
Clamping
Learning
Guild override
Personal gain
Computed default resolution
```

You can test it without opening Discord:

```sh
node test-gain-math.js
```

That is the scratchpad copy used during development.

All cases pass.

It is not glamorous, but it means the math was not the part that broke everything.

Discord internals were.

As usual.

## Final word from the booth

CRAYON is not here to reinvent audio engineering.

CRAYON is not here to master your friends' microphones.

CRAYON is here to remember that Kevin is too loud, Sarah is too quiet, and you already fixed both of them last Tuesday.

It is simple. It is useful. It is free ninety-nine.

This has been your man Crayon, coming to you live with better voice levels, fewer slider rides, and a plugin that remembers so you do not have to.

Stay colorful. Stay calibrated. Stay in the lines.
