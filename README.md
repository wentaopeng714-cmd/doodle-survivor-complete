# Doodle Survivor

A zero-dependency vertical Canvas survival-roguelite prototype, evolved from the existing room-based MVP without replacing its renderer or controls.

## Run

Open `index.html` directly, or serve this directory with any static file server.

## Controls

- Desktop: WASD or arrow keys.
- Touch/pointer: drag anywhere on the playfield.
- Eraser: automatically triggers once unlocked; the button can trigger it early when ready.

## Run structure

- 0:00–1:00: quiet margins
- 1:00–2:00: mixed doodles and ranged enemies
- 2:00–3:00: dense notes and elites
- 3:00–4:00: ink storm
- 4:00: boss encounter

The world is streamed as deterministic nearby chunks rather than stored as one large map. Chunk edges are visually seamless, while rocks, dead trees, ruins, and crates have physical collision for both the player and enemies. Five skills each progress to level 5.

The illustrated world shifts smoothly between meadow, ruin, and graveyard prop mixes. Optional cache, shrine, and bloom events appear during the run. Combat includes hit pause, knockback, paper scraps, skill interactions, phase announcements, synthesized paper-fantasy sound cues, and a boss that leaves ink hazards and breaks solid scenery.

The ground now uses a continuous warm watercolor-paper wash with world-anchored fibers and marks. A quiet original music-box loop starts with the run and shares the lower-left audio toggle with sound effects. Enemy atlas regions use per-character bounds so neighboring artwork cannot bleed into the skeleton sprite.

Each run now begins with a choice of Pencil Sword, Ink Orbit, or Paper Plane. Finished runs save personal best time, best level, boss victories, and discovered skills locally in the browser.
