# Latte stage-two asset prompts

Mode: built-in `imagegen`

All generated assets use the approved `latte-base-preview-v1.png` as the locked identity and rendering reference. Original photographs are supporting motion, anatomy, and clothing references only.

## Click reaction sprite sheet

Use case: `stylized-concept`

Create an exact six-frame, 3-column by 2-row transparent sprite sheet of Latte reacting to a mouse click. Read left-to-right, then top-to-bottom: relaxed three-quarter side pose; head and gaze begin lifting; head lifted higher; peak upward-looking pose; head returning; recovered pose with one front paw lightly raised. Keep every dog at identical scale, camera, ground baseline, and registration. Animate mainly the head, neck, ears, gaze, and final front paw. Match the approved semi-realistic 70/30 Q-version design exactly. Preserve the adult female dog's asymmetric white muzzle/nose-bridge marking, forehead streak, dark floppy ears, compact short-legged body, exact brown patches, and tightly curled white tail in every frame. Unclothed. Genuine transparent alpha; no floor, shadow, grid, labels, text, duplicate dogs, extra limbs, crop, or identity drift.

Targeted correction: change only the background to genuine transparency while preserving the six frames, layout, identity, rendering, and edges. Preserve fine fur with partial alpha and remove background matte contamination.

## Walk cycle sprite sheet

Use case: `stylized-concept`

Create exactly four large, clean keyframes in a 2-column by 2-row grid, read top-left, top-right, bottom-left, bottom-right. Preserve Latte's exact face, white forehead blaze and muzzle, brown-and-white coat pattern, floppy ears, compact adult female proportions, short legs, tightly curled white tail, lighting, and established 70% believable real dog / 30% gentle cute Q-version rendering. Strict side view facing screen-right, with no clothing. Use a true slow four-beat canine walk: frame 1 lifts the near hind leg, frame 2 lifts the near front leg, frame 3 lifts the far hind leg, and frame 4 lifts the far front leg; the other three paws are visibly planted in every frame. Keep all four legs separate, anatomically attached, and countable. Show the far-side pair slightly darker and offset behind the near-side pair. Preserve identical body, head, markings, tail, size, body length, horizontal registration, and ground baseline, allowing only 1–2% torso rise/fall. Frame 4 loops smoothly into frame 1. Genuine transparent alpha with identical padding; no floor, shadow, scenery, grid, text, cropped paws, crossed or merged legs, duplicated or missing limbs, running, trotting, pacing, skating, or identity drift.

### Walk in-between frames

Use case: `precise-object-edit`

Using the approved 2-by-2 key-pose sheet, create a matching 2-by-2 sheet containing only the four halfway transitions: key 1 to key 2, key 2 to key 3, key 3 to key 4, and key 4 back to key 1. Preserve the exact dog identity, head, face, expression, markings, tail, body length, lighting, scale, camera, side-view direction, cell size, and registration. Change only the minimum leg joint positions needed for each midpoint. Keep all four legs visible, separate, anatomically attached, and consistent with the adjacent keys; at least three paws touch or sit immediately beside the common baseline. No key-pose duplicates, body or head movement, floor, shadow, grid, text, crop, merged or extra limbs, motion blur, or identity drift.

The generator returned a baked checkerboard instead of an alpha channel. A targeted `background-extraction` pass was attempted first. Because that output was still opaque, a final `precise-object-edit` pass changed only the background to flat chroma green `#00FF00`; `scripts/chroma-key-alpha.ps1` then converted the green matte to real RGBA without redrawing the dog.

### Video-guided final walk cycle

Use case: `stylized-concept`

Input image 1 is the sole locked reference for identity, face, coat markings, rendering style, and color. Match its low-saturation light-brown patches and creamy-white fur exactly; do not make the brown more orange, red, golden, or saturated. Extracted frames from `images/video.mp4` are motion references only: use Latte's authentic low sniffing head posture, relaxed neck, slightly lowered shoulders, compact short steps, stable curled tail, and leg timing. Ignore the blue coat, collar, harness, leash, snow, scenery, lighting cast, and camera perspective. Create exactly eight sequential frames in a 4-column by 2-row sheet, strict clean side view facing screen-right. Frames 1, 3, 5, and 7 are successive four-beat footfall keys; frames 2, 4, 6, and 8 are true halfway transitions. Keep all four legs visible and separate, at least three paws supporting each key pose, body rise/fall within 1–2%, and frame 8 flowing into frame 1. Preserve identical size, body length, head size, colors, markings, registration, and baseline. No clothing, scenery, shadow, long stride, stiff legs, running, trotting, pacing, skating, merged or missing limbs, head popping, or color drift.

The accepted generated sheet was converted through flat chroma green to real RGBA. Its eight frames then received one shared deterministic color calibration (`R × 0.920`, `G × 0.932`, `B × 0.928`) against `latte-base-preview-v1.png`; no per-frame grading was used.

## Sleep cycle sprite sheet

Use case: `stylized-concept`

Create an exact four-frame, 2-column by 2-row transparent sleeping-breath loop. Latte lies curled comfortably on her side/belly, paws tucked, head resting near her paws, eyes closed. Keep the underlying pose fixed and animate only a subtle exhale, chest rise, inhale peak with tiny ear movement, and return to exhale. Identical scale, camera, baseline, and registration. Match the approved master identity, coat pattern, compact adult anatomy, curled white tail, lighting, and semi-realistic 70/30 Q-version style. Unclothed. No bed, blanket, floor, background, shadow, text, crop, extra limbs, or pose drift.

## Stretch cycle sprite sheet

Use case: `stylized-concept`

Using the supplied finalized character image as the exact identity reference, create one production-ready 6-frame animation sprite sheet for the desktop pet Latte (拿铁), a small female mixed-breed dog. Preserve her exact recognizable facial markings, warm brown-and-white coat patches, floppy ears, dark round eyes, white muzzle and forehead blaze, compact body, curled fluffy tail, and the established style balance of about 70% believable real dog and 30% gentle cute Q-version. She wears no clothing. Action: a natural wake-up stretch / play bow. Six distinct sequential poses in reading order, left-to-right across the top row, then left-to-right across the bottom row: neutral standing; beginning to reach forward; full play-bow stretch; holding the deepest stretch; pushing back up; returning to a content neutral stand. Exact 3 columns by 2 rows, one centered full-body dog per equal cell, generous consistent transparent padding, entire dog visible, paws and body contact point on a consistent vertical baseline, stable scale and body proportions, and no overlap. Transparent alpha; no scenery, ground plane, detached shadow, border, grid, label, text, duplicated limbs, extra animals, or accessories.

## Blue winter coat

Use case: `precise-object-edit`

Edit only the approved base image by adding a fitted medium-bright blue quilted winter coat inspired by the supplied photo. Add two narrow white reflective stripes and neat gray edging. Leave the head, ears, neck fur, lower legs, paws, rump, and curled tail visible. Preserve the original canvas, transparent alpha, crop, pose, silhouette, face, gaze, markings, anatomy, fur, and lighting exactly. Do not include the photo's leash, harness, buckles, yellow neck ring, red scarf, labels, logos, or people.

## Black puffer coat

Use case: `precise-object-edit`

Edit only the approved base image by adding a fitted matte black-to-charcoal quilted puffer jacket inspired by the supplied photo, with restrained dark-gray piping and short fitted front-leg sleeves. Leave paws, hind legs, head, ears, neck fur, rump, and curled tail visible. Preserve the original canvas, transparent alpha, crop, pose, silhouette, face, gaze, markings, anatomy, fur, and lighting exactly. Do not include a leash, harness, buckles, logos, labels, or people.
