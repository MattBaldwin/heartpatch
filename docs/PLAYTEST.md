# Playtest checklist (Phase 1: Halloween)

A short bug-bash list for playing Heartpatch on iPhone and iPad. The **owner** sections are for the grown-up running the playtest. The **tester** sections are for the kids playing: tick what works, and tell us about anything that doesn't.

Where the game runs, the seed accounts and the local dev setup are in [DEPLOY.md, "Playtesting"](DEPLOY.md#9-playtesting).

## Before inviting testers (owner)

- [ ] The real server is up at `https://play.pumpkinpatchgames.com` (DEPLOY.md steps 1–7), or a local playtest is running (DEPLOY.md, "Playtesting").
- [ ] **The tutorial is required:** check `HP_TUTORIAL_REQUIRED=true` in `/opt/heartpatch/.env` (owner decision 2026-10-04; DEPLOY.md, "Changing a setting"). New players meet Sprout right after the story and finish the tutorial before making or joining a patch. While it's required, Sprout has no "Later" button until the tutorial is done, but "Log out" in the Keeper menu (the round Keeper button in the corner) always works. If the tutorial ever gets stuck, set it to `false` and restart so testers can keep playing. For a local playtest, set it in your local `.env` too.
- [ ] **Matt shares the family code (`HP_SIGNUP_CODE`) in person**, never in a text or group chat. Each tester knows to keep their recovery code somewhere safe.
- [ ] A friend who asks to join a patch before finishing Sprout's tutorial gets "still getting ready" when the owner says yes. That's expected: finish Sprout first, then say yes again.
- [ ] At least one tester starts on a **brand-new account**, so the whole first session (Keeper, story, Sprout) gets played. On a second new account, have someone press and hold to skip the story the very first time it plays (it should skip).
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
- [ ] Sprout pops up by itself after the story. Play the tutorial (there's no "Later" yet, that's on purpose).
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

- [ ] Tap a spot on your land and "Gather". Come back later: what you gathered lands in your Bag by itself.
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
- [ ] A friend challenges your land. Afterwards, the Challenge report says what happened.

**The Hollow**

- [ ] Light a Hearthfire before night falls.
- [ ] Next morning: see who the Hollow Man visited. Squishies by a lit fire stay safe.
- [ ] Rescue a squishy from the Hollow. They come home!

**Exploring your land**

- [ ] Tap a tile you own, press Explore, and walk your Keeper with the joystick.
- [ ] Walk up to a sparkle and press the big button. Your Keeper digs, shakes or scoops right there.
- [ ] Look up! The sky matches the time: sunny clouds by day, warm colours at dawn and dusk, stars and a moon from around 7 PM.
- [ ] Make a tool (Shovel, Snorkel, Walking Stick or Lantern) and use it on a trickier spot.
- [ ] Find a lore page and open it in your Lorebook (Bag → 📖 Lorebook).

**Home, trading posts and the factory**

- [ ] Build a Crafting Factory at home and start a batch. Come back later: the goodies are in your Bag.
- [ ] Tap a trading post with a 🏮 flag and start a journey. Win the trail showdown.
- [ ] At a post with a 🔗 flag, send a friend a gift or make a trade. They find it in their mailbox.

**Brand-new things (only if Matt says they're in this build)**

- [ ] **Dress up:** buy a squishy accessory in the Boutique, open your squishy up close and tap "Put on". You see it on your squishy. "Take off" works too.
- [ ] **Friendly battles:** tap a patch-mate who's online and ask "Battle me?". They can say yes or "Not now!". Nothing is at stake, win or lose.
- [ ] **Live defense:** when a friend challenges your land while you're playing, you get "Defend now?" and can play it yourself.

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

## iPhone and iPad (testers)

Play a bit on each kind of device if you can.

- [ ] Turn the iPhone sideways and back. Nothing gets cut off or stuck.
- [ ] On the iPad, try it both ways up too. Buttons are easy to tap and words are easy to read.
- [ ] Leave the game for a few minutes (go to the Home Screen), then come back. You're right where you were.
- [ ] Nothing looks blurry or blocky, on either device.

## Nudges (owner, on a real iPhone)

Nudges only work in the Home Screen app (iOS 16.4 or later). Turn them on for yourself first: `HP_PUSH=testers` with `HP_PUSH_TESTERS=<your username>` (the 726e handoff on #726 has the steps for each nudge).

- [ ] In Safari (not the Home Screen app), no nudge card shows, and Settings › Nudges says "Add to Home Screen first" with "Show me how".
- [ ] Open the Home Screen app on a patch, after Sprout's tutorial. "Want a nudge when night falls? 🔥" shows **once**, and not over another card.
- [ ] "Yes please" brings up the iPhone's own "Allow notifications?" question. "Allow" shows "Nudges on! 🔔" on the patch.
- [ ] Reopen the app: the card never comes back. (It's once per iPhone, not per account: try "Not now" on a second device.)
- [ ] **A friend is here:** a second account opens your patch after you've been away 10 minutes. You get "<name> is in your patch! 👋".
- [ ] Tap the nudge with the app open in the background: it opens that patch. The red dot on the app icon goes away.
- [ ] Settings › Nudges shows "On" and four switches (the Long Night one only on a patch with a Long Night day). Turn "A friend is here" off: no more friend nudges.
- [ ] Turn Nudges off and on again in Settings. Off: nothing comes. On: no second iPhone question.
- [ ] Turn notifications off in iPhone Settings › Notifications › Heartpatch: Settings › Nudges says "Off in iPhone Settings".
- [ ] Log out: nudges stop. Log back in: Settings shows "Off" and offers "On".
- [ ] Known: a "Your gatherers are done!" nudge can come for a gather that was really lost (its tile changed hands). It just opens the app.

## Spooky, not scary (owner, with the testers)

Watch the story with each tester, paying special attention to **shot 4, "The Hollow Man"** (the tall, flickering shape at the edge of the trees).

- [ ] It feels **spooky but not scary**: colours fade, the music goes quiet, he flickers, the squishies huddle. Nobody gets hurt, and he never speaks or chases.
- [ ] Ask: "Was any part too scary?" If a tester says yes, note the moment and their age.
- [ ] The Hollow Man's night visits on the map feel the same way, and the morning report says the squishy can be rescued.

## Day-N cold play (owner, weekly, 20 minutes)

The checklists above ask "does it work?". This one asks "is it fun on day 10?" (#736). Once a week, play one account that's already a few days in, through fresh eyes.

1. **Seed three accounts** that stand where a kid would be on **day 3, day 10 and day 21**, with the dev fast-forward (#736). It only runs on a local playtest with `HP_DEV_SQUISHY_GRANTS=true` (DEPLOY.md, "Playtesting"), never on the real server.
   - Sign up a fresh account for each day, make a patch (or join one), and pick a first squishy.
   - Signed in as that account, on a computer, open the game, then the browser's console, and paste this (change `10` to `3` or `21`; the patch is the account's first one, or put its name in `name`):

     ```js
     const name = null; // or 'My Patch'
     const day = 10;
     const headers = { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' };
     const { maps } = await (await fetch('/api/v1/maps', { headers })).json();
     const map = maps.find((m) => name === null || m.name === name);
     const res = await fetch(`/api/v1/maps/${map.id}/dev/fast-forward`, {
       method: 'POST',
       headers,
       body: JSON.stringify({ day }),
     });
     console.log(await res.json());
     ```

   - The account now matches the casual kid's "end of day N" in `pnpm sim:progression`: its Partner grows (and evolves) to that day's level, that day's two teammates join the team, its land grows to that day's tile count (the nearest free tiles), and it joined the patch N days ago. Care and job timers stay fresh, like a kid who plays every day. It only moves forward, so pasting it twice is safe. Use a fresh account for each day. The seeded squishies and the Partner's evolutions don't count as seen or evolved (milestones, the species list) until they happen in play, and the new land is the nearest free tiles, so it can leave gaps.
   - Restart the server with `HP_DEV_SQUISHY_GRANTS` off before the kid plays (the dev routes hand out free things).
2. **Hand one to a kid who hasn't seen that state.** Not the account's own player, and not a kid who's already that far in. Don't explain anything; just watch.
3. **Write down three things:**
   - [ ] the first thing they tried to do,
   - [ ] the first moment they put the phone down,
   - [ ] what they said they wanted.
4. **File each one** as a GitHub issue titled `Playtest: day N: <quote>`, using their own words, like `Playtest: day 10: "I want a sparkly one"`.

Compare with the "firsts" row in `pnpm sim:progression`: what new thing should that kid have been meeting around day N?

## Performance (owner)

The frame-rate badge only shows in a **dev build**, so do this pass on a local playtest (DEPLOY.md, "Playtesting"), not on the real server. The badge in the corner reads, part by part, frame rate · renderer · quality tier · render scale · draws · triangles, like `58 fps · WebGL2 · high · 2.00x · 42 draws · 120k tris`; `idle` means nothing is moving, so nothing is being drawn. Test on a recent iPhone and the **oldest iPad** you have. The dev build isn't minified like the real one, so the real game runs at least this fast.

- [ ] **Map:** pan, fling and pinch for a minute on a busy patch. Recent iPhone holds about **60 fps**. The older iPad **never drops below 30**.
- [ ] **Battle, home base and close-up view:** the same targets.
- [ ] **Explore:** walk around a tile for a minute, at night too (the starry sky). The same targets.
- [ ] **Story, shot 1 "The Heartpatch"** (the whole land with its Heart Seeds): at least 30 on the older iPad.
- [ ] **Story, shot 5 "The Great Scatter"** (the Heart Seeds shatter, everyone scatters): the busiest shot. At least 30 on the older iPad, with no long freeze.
- [ ] **Story, shot 6 "The land today"** (the wide view over today's land): at least 30 on the older iPad.
- [ ] Nothing ever looks pixelated or blurry. The render scale (the `2.00x` part) can drop a little on the older iPad. That's the dynamic scaler doing its job.
- [ ] Put the app in the background for a minute, then come back. The picture comes back (no blank screen).
- [ ] Note any spot that stutters, the device, and what the badge said. File it like a bug.

**How to measure on the older iPad** (#28's "30+ fps on an older iPad"; only a real device counts):

1. Start a local playtest and open `http://<your computer's address>:5173` in Safari on the iPad (DEPLOY.md, "Playtesting"). Plug it in and turn Low Power Mode off: it caps frame rate.
2. Play at the default quality first. The badge's third part is the tier the game picked (`high`, `medium` or `low`) and the fourth is the render scale (like `1.50x`); the game steps down by itself if it's struggling, so note where it settles.
3. To see a tier on purpose, add it to the address: `?quality=medium` or `?quality=low` (e.g. `http://192.168.1.20:5173/?quality=low`). Try `low` on the older iPad if `high` dips under 30.
4. For each place above (map, battle, home, close-up, story shots 1, 5 and 6, and an explore walk), write down the **lowest** fps you saw while things were moving (ignore `idle`), the tier and the render scale:

| Device and iPadOS | Place | Lowest fps | Tier | Scale | Notes |
| --- | --- | ---: | --- | ---: | --- |
| | | | | | |
