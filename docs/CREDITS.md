# Credits & third-party material

The MIT license in `LICENSE` covers the original source code of this project only. It does not
relicense any third-party asset listed here; each keeps its own license or rights. Crediting an
asset does not by itself grant permission to use it.

## Open-source libraries and models

| Material | Creator / source | License |
|---|---|---|
| Pose detection runtime `@mediapipe/tasks-vision` 1.1.1 (WASM copied into `public/mediapipe/` at build time) | Google, [MediaPipe](https://developers.google.com/mediapipe) | Apache-2.0 |
| Pose model `pose_landmarker_full.task` (downloaded at runtime from Google's CDN, not stored in this repository) | Google, MediaPipe Pose Landmarker | Apache-2.0, per Google's MediaPipe model documentation |
| 3D engine `three` 0.186.1 | [three.js authors](https://threejs.org/) | MIT |

## 3D character model (CC-BY-4.0, attribution required)

`public/models/michael_jackson_thriller.glb`

> "Michael Jackson (Thriller)" by [MrLOCKiDY](https://sketchfab.com/MrLOCKiDY), from
> [Sketchfab](https://sketchfab.com/3d-models/michael-jackson-thriller-5747d705aeaf4c6fa3b3c50d01906ab8),
> licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).
> Changes: the model file is unchanged; the game adds a skeleton and skin weights at load time
> (`src/arena/characters/glbMichael.ts`) and animates it.

Title, creator, source and license as embedded by Sketchfab in the file's `asset.extras`.
CC-BY-4.0 covers the model itself, not Michael Jackson's name or likeness.

## Michael Jackson reference material (rights belong to their holders)

These files are included for this unofficial, non-commercial fan project. They are **not**
covered by this project's MIT license, no permission from the rights holders is claimed, and
they may not be reused under this project's license.

| Game use | File(s) | Source / rights holder | Status |
|---|---|---|---|
| Pose card photos (6 playable poses) | `public/poses/*.webp`, `public/poses/diagonal-reach.png` | Photographs of Michael Jackson; photographers / rights holders not identified | Copyrighted, used without a license |
| Attack voice ("hee-hee") | `public/audio/local/mj-hee-hee.mp3` | Voice of Michael Jackson; uploaded clip, original source unknown | Copyrighted, used without a license |
| Player hit sound | `public/audio/local/player-damage.mp3` | Minecraft (Mojang Studios / Microsoft) | Copyrighted, used without a license |
| Attack release / shockwave | `public/audio/local/energy-swell.mp3` | Unknown sound-effect upload | License unknown |
| Zombie groans (8 slices) | `public/audio/local/zombie-groan-1..8.m4a` | Unknown sound-effect upload ("zombie group roaming") | License unknown |

Rights holders who want any of this material removed can open an issue on the repository.

## Not included

- Background music: the "Thriller" recording (Michael Jackson, Epic Records / Sony Music) is a
  commercial recording. It is not part of this repository and is removed from production builds;
  the public game plays without background music.

Everything else visible in the game (zombies, cemetery, fog, sky, VFX, HUD) is original work in
this repository's code.
