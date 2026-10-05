# Heartpatch — Style Guide

> How Heartpatch **sounds, reads and feels**. `GAME_DESIGN.md` says what the rules are; this file keeps every piece of player-facing content and UI in one voice, no matter which session wrote it. The PR reviewer checks content and client PRs against this guide.

## 1. Tone

**Cozy, cute, playful and funny.** Lightly spooky in October, never scary.

- Warm first. Every screen should feel like a hug from a friendly toy shop.
- Funny through gentle silliness: squishies are a little clumsy, a little dramatic, very sincere.
- Spooky through **atmosphere and absence** (dimming light, silence, a flicker at the edge of the screen), never through threats, gore, injury, jump scares or cruelty.
- Nobody is ever hurt. Squishies get **tuckered out**, **sleepy**, **dizzy** or **taken to the Hollow** (and always rescuable). Words to avoid are listed in §9.

## 2. Reading level and length

Players are 10–17; write so a 10-year-old reads it at a glance.

- Short sentences. Most UI lines under ~10 words; Sprout lines under ~20.
- Common words. No jargon, no stats-speak in the main UI ("Super cozy!" not "1.5× feeling multiplier"). Numbers live in an optional info card.
- Speak to the player as "you", warmly. Never scold.
- One idea per line or bubble.

## 3. Easy to pick up (UX rules)

Applies to every client PR.

1. **Teach one thing at a time.** Every mechanic is introduced by the tutorial or a first-time Sprout tip before the player needs it.
2. **Big, obvious controls.** Minimum 44×44 pt tap targets. All game controls reachable one-handed on iPhone.
3. **No hidden essentials.** Every gesture (stroke to pet, pinch to tickle, long-press) has a visible button alternative.
4. **Show, then tell.** Effectiveness callouts, colour, motion and sound before text. Detail is opt-in.
5. **Always a next step.** Every screen makes the obvious next action obvious; no dead ends.
6. **Forgiving.** Confirm anything you can't undo, with a clear, friendly summary of what will happen.
7. **Calm feedback.** Errors read like a friend helping ("That tile's too far away — try one next to your land!"), never like a system error.

## 4. Naming

### Squishies
- Squishy, cute and **pun-friendly**; easy for a kid to say out loud and remember (2–3 syllables is ideal).
- Name hints at element or feeling: *Puddlepuff* (Water/Silly), *Pebblesnooze* (Stone/Sleepy).
- Evolutions sound like a bigger, sparklier version of the same name: *Puddlepuff → Splashmallow*.
- No existing franchise names or near-copies (no "-mon", no recognisable characters).

### Seasonal squishies
- Each one has a **seasonal reason to exist** and a **seasonal activity that draws it**: found in pumpkin fields while gathering Pumpkins, drawn to Jack-o'-Lantern Hearthfires, appearing near Witch Dust nodes at dusk.
- Halloween ones are *sweet-spooky*: a ghost who's afraid of the dark, a pumpkin with a lopsided grin, a bat that hangs the wrong way up.

### Moves
- Silly or sweet verbs, never violent: *Tickle Tackle*, *Belly Flop*, *Giggle Drizzle*, *Rock-a-Bye*, *Peekaboo!* (Avoided words: §9.)

### Clothing, titles and items
- Descriptive and fun: *Pumpkin Hood*, *Ghost Cape*, *Cozy Apron*, *Heart Mittens*.
- Titles feel earned and kind: "Keeper of the Gap", "Hollow Rescuer", "Friend to All Squishies".

### Places
- Use the established names: **Juniper's Gap**, **the Hollow**, **the Heartpatch**, **Heart Seed**, **Hearthfire**, **Tutorial Glade**. Don't invent alternates.

## 5. Characters

### Sprout (tutorial guide)
The tiny glowing spirit of your Heart Seed. Upbeat, curious, easily delighted, a little dramatic, always encouraging.
- Speaks in short bursts with the occasional "Ooh!" or "Ta-da!"
- Notices funny details: *"Ooh, a wild squishy! It looks friendly… and a little bit sticky."*
- Gentle urgency, never panic: *"Brrr, it's getting dark. Quick, let's get everyone near the fire!"*
- Celebrates the player, not itself.

### The Hollow Man
**Spooky-tense** (owner decision 2026-10-04, replacing "spooky stays soft"): a tall, thin, dark silhouette with a ragged cloak, long reaching arms and glowing eyes. A little scary, never gory, and fine for ages 10–17.
- He **never speaks**, never threatens, never chases on screen, and never rushes at the camera. No jump-scares, no mouth, no claws, no blood.
- Present it through what changes around him: colour drains, music drops out, firelight flickers, squishies huddle.
- When he wants something, he reaches for it with his long arms and his eyes flare. In the opening story he pulls the glow (joy) out of the squishies as little lights, and a cold wind scatters them; a low rumbling sting and a short camera shake mark the Heartpatch breaking. That's the most frightening he ever gets.
- **Reduced motion:** no shake, no flicker, no flash, and his eyes don't flare.
- On the map he hesitates at light and noise, and fades away. Players should feel "I can protect them," not fear.
- Taken squishies turn grey and drift away gently; text always reminds the player they can be rescued.

### The forest chihuahuas
Lore only (see design doc §16). Never NPCs, never explained outright. Glimpses, paw prints, distant barking.

### Squishies
Sincere, expressive, never mean. Feelings drive personality: Joy bounces, Cozy snuggles, Brave puffs up, Silly spins, Sleepy nods off, Spooky goes "boo!" and then giggles.

## 6. Writing for each surface

| Surface | Guidance |
|---|---|
| Buttons | 1–2 words, verb first: "Feed", "Capture", "Light fire" |
| Toasts | One short line, upbeat: "Gourdon joined your patch!" |
| Errors | Friendly, say what to do next. Shared error codes map to kid-readable messages. |
| Sprout bubbles | ≤ 2 short sentences per bubble; tap to continue |
| Captions (cinematic) | Large, rounded type; stay up long enough to read; tap to advance |
| Morning report | Calm and reassuring: "The Hollow Man came by last night, but your fire kept everyone safe!" |

## 7. Visual and audio feel

Visuals follow design doc §19 (soft vinyl toy, glossy, rounded, never pixelated). Audio follows tech spec §15. Sounds are soft, round and bouncy: squeaks, boops, pops, chimes. Spooky moments use quiet, low drones and silence, not screams. The one sting is the opening story's low rumble as the Hollow Man reaches for the Heartpatch (§5).

## 8. Safety checklist for content

- [ ] No violence, injury, death or gore language
- [ ] Nothing frightening for a 10-year-old (Hollow Man rules above)
- [ ] No real brands, franchises or copyrighted characters
- [ ] No real-money prompts, ads or "buy now" language
- [ ] All user-typed text (usernames, nicknames, outfit names) goes through the server filter

## 9. Words to use and avoid

### Glossary
Player-facing words for game actions. The code can use technical names; the UI uses these.

| Mechanic (code) | Say in the UI |
|---|---|
| attack a tile | **Claim** (neutral tile), **Challenge** (rival tile) |
| raid on your tile | **"Someone challenged your patch!"** |
| battle | **Battle** or **Squishy showdown** |
| squishy at 0 HP | **Tuckered out** |
| damage / HP | **Energy** (the bar), "lost some energy" |
| capture | **Befriend** (button: "Use Heart Charm") |
| hollowed | **Taken to the Hollow** (always followed by "you can rescue them!") |
| defense stance | **Defense style** (Bold, Careful, Balanced) |

### Avoided words
One list, so tests can scan the **player-facing string fields** in data files (names, descriptions, lines, captions; not keys like `baseStats.attack`). Don't use these in player-facing text:

`die`, `dead`, `death`, `kill`, `faint`, `hurt`, `injure`, `wound`, `bleed`, `blood`, `damage`, `destroy`, `crush`, `slash`, `stab`, `bite`, `attack` (in UI; fine in code), `weapon`, `enemy`, `hate`, `stupid`, `loser`.

