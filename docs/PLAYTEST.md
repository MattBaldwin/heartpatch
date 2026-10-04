# Playtest checklist (Phase 1: Halloween)

A short bug-bash list for playing Heartpatch on iPhone and iPad. The **owner** sections are for the grown-up running the playtest. The **tester** sections are for the kids playing: tick what works, and tell us about anything that doesn't.

Where the game runs, the seed accounts and the local dev setup are in [DEPLOY.md, "Playtesting"](DEPLOY.md#9-playtesting).

## Before inviting testers (owner)

- [ ] The real server is up at `https://play.pumpkinpatchgames.com` (DEPLOY.md steps 1–7), or a local playtest is running (DEPLOY.md, "Playtesting").
- [ ] **Decide whether the tutorial is required.** `HP_TUTORIAL_REQUIRED` is still an open owner question, so this checklist doesn't pick. `false` (today's default): new players land in the lobby and Sprout is offered. `true`: Sprout opens by itself until it's done. Either way, "Later" and "Log out" always work, and the story never blocks play (DECISIONS.md, "2026-10-02 — Architecture and product audit", decision A). Set it in `/opt/heartpatch/.env` (DEPLOY.md, "Changing a setting").
- [ ] Each tester has the **family code** (`HP_SIGNUP_CODE`) and knows to keep their recovery code somewhere safe.
- [ ] At least one tester starts on a **brand-new account**, so the whole first session (Keeper, story, Sprout) gets played. Hold-to-skip works even the first time the story plays, so have someone try it on a second new account too.
- [ ] **On a local playtest, leave `HP_DEV_SQUISHY_GRANTS` unset** in `.env` (or `false`). It turns on dev routes that hand out free coins, clothes, items and squishies, which would skip the economy checks below. The dev build still shows grown-up test buttons, labelled "(dev)" or "Dev:"; with the setting off they don't hand out anything. Tell testers to ignore them.
- [ ] Every iPhone and iPad is on the latest iOS/iPadOS. Add the game to the Home Screen (Share → Add to Home Screen) and play from there.

## How to report a bug (testers)

Found something odd? Yay, that's the whole point! 🎃

1. **Take a screenshot** (press the side button and volume-up together).
2. **Tell the grown-up running the playtest:**
   - what you tapped,
   - what happened,
   - what you thought would happen,
   - which device (iPhone or iPad).
3. If it keeps happening, say so. "Every time" is super helpful.

Things that feel boring, confusing, too hard or too spooky count too!

**Owner:** file each one as a GitHub issue titled `Playtest: <short summary>`, with the screenshot, the device and iOS version, the tester's username and the steps. Add the `phase-1-halloween` label.

## Getting started (testers, on a new account)

- [ ] Sign up with the family code, a name, a password and your birth year.
- [ ] You see a recovery code. Save it, then tap "I saved it!".
- [ ] Pick your Keeper. Change their hair, eyes and outfit. Tap "That's me!".
- [ ] The story starts. Tap to move the words along.
- [ ] Press and hold on the story to skip it.
- [ ] Meet Sprout in the lobby. Play the tutorial, or tap "Later" and come back to it.
- [ ] Finish the tutorial: you get The First Patch milestone and a Seedling Scarf.
- [ ] Log out and log back in. You land where you left off, and the story doesn't play again.

## Each part of the game (testers)

See a button that says "dev"? That's a grown-up test button. Skip it!

**Patches and the map**

- [ ] Make a patch. Share its invite code with a friend.
- [ ] A friend asks to join, and the patch owner taps "Yes!".
- [ ] "Visit patch", then choose your first squishy friend.
- [ ] Drag to move around the map, and pinch to zoom. It feels smooth.
- [ ] Your friend's Keeper stands at their home base.

**Gathering and making things**

- [ ] Tap a spot on your land and "Gather". Come back later and "Collect".
- [ ] Open your Bag. "Make" something, like a Heart Charm.

**Care**

- [ ] Open a squishy and tap Care. They look happy.
- [ ] "Up close" shows your squishy big and squishy.

**Befriending and battles**

- [ ] Tap "Find a squishy" and battle a wild one.
- [ ] Use a Heart Charm to befriend it. A new friend joins you!
- [ ] Battles are easy to follow, even the first time.
- [ ] After enough battles, your squishy grows into a new, bigger friend. It gets a "Whoa!" party.

**Claiming land and raids**

- [ ] Tap wild land next to home and "Claim". Win the showdown: "This land is yours!".
- [ ] Put a squishy on watch on your new land.
- [ ] A friend challenges your land. Afterwards, the Raid report says what happened.

**The Hollow**

- [ ] Light a Hearthfire before night falls.
- [ ] Next morning: see who the Hollow Man visited. Squishies by a lit fire stay safe.
- [ ] Rescue a squishy from the Hollow. They come home!

**Chat**

- [ ] Open Chat on a patch and send a phrase, an emoji and a sticker.
- [ ] Your friend sees them.

**Wardrobe, Boutique and milestones**

- [ ] Open the Wardrobe and try things on your Keeper (after Sprout's tutorial, wear the Seedling Scarf!).
- [ ] Earn Patch Coins (battles, new friends, care), then buy something in the Boutique.
- [ ] Open Milestones, see your progress, and wear a title your friends can see.

**Tutorial and story again**

- [ ] Settings → "Play again" with Sprout, then "Skip it".
- [ ] Settings → "Watch the story". It has a Skip button now.

## Spooky, not scary (owner, with the testers)

Watch the story with each tester, paying special attention to **shot 4, "The Hollow Man"** (the tall, flickering shape at the edge of the trees).

- [ ] It feels **spooky but not scary**: colours fade, the music goes quiet, he flickers, the squishies huddle. Nobody gets hurt, and he never speaks or chases.
- [ ] Ask: "Was any part too scary?" If a tester says yes, note the moment and their age.
- [ ] The Hollow Man's night visits on the map feel the same way, and the morning report says the squishy can be rescued.

## Performance (owner)

The frame-rate badge only shows in a **dev build**, so do this pass on a local playtest (DEPLOY.md, "Playtesting"), not on the real server. The badge in the corner reads like `58 fps · WebGL2 · high · 2.00x`; `idle` means nothing is moving, so nothing is being drawn. Test on a recent iPhone and the **oldest iPad** you have. The dev build isn't minified like the real one, so the real game runs at least this fast.

- [ ] **Map:** pan, fling and pinch for a minute on a busy patch. Recent iPhone holds about **60 fps**. The older iPad **never drops below 30**.
- [ ] **Battle, home base and close-up view:** the same targets.
- [ ] **Story, shot 1 "The Heartpatch"** (the whole land with its Heart Seeds): at least 30 on the older iPad.
- [ ] **Story, shot 5 "The Great Scatter"** (the Heart Seeds shatter, everyone scatters): the busiest shot. At least 30 on the older iPad, with no long freeze.
- [ ] **Story, shot 6 "The land today"** (the wide view over today's land): at least 30 on the older iPad.
- [ ] Nothing ever looks pixelated or blurry. The badge's last number (render scale) can drop a little on the older iPad. That's the dynamic scaler doing its job.
- [ ] Put the app in the background for a minute, then come back. The picture comes back (no blank screen).
- [ ] Note any spot that stutters, the device, and what the badge said. File it like a bug.
