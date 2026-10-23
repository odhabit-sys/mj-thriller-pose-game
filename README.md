<div align="center">

# MJ Thriller Pose Game

A browser-based webcam pose game where your body becomes the controller.<br>
Match iconic dance poses to unleash attacks and survive waves of zombies in a supernatural graveyard.

[![▶ PLAY LIVE](https://img.shields.io/badge/%E2%96%B6%20PLAY%20LIVE-mj--thriller--pose--game.vercel.app-f5c518?style=for-the-badge&labelColor=1a1626)](https://mj-thriller-pose-game.vercel.app)

**[mj-thriller-pose-game.vercel.app](https://mj-thriller-pose-game.vercel.app)** · Desktop browser + webcam · No install

![Wave 6: a confirmed Arms Overhead pose releases a golden shockwave](docs/images/pose-hit-wave6.jpg)

</div>

## The Game

Zombies are closing in on MJ in a moonlit cemetery, and your webcam is the only controller. A pose card shows the move to make. Copy it with your body, hold it for a moment, and MJ performs it, releasing a golden shockwave that blasts back the undead. Each wave brings more zombies and harder poses.

## How to Play

1. Open the [live game](https://mj-thriller-pose-game.vercel.app) and click **ENABLE CAMERA**.
2. Step back until your shoulders, arms and hips are in view, then click **START GAME**.
3. Copy the pose on the **MATCH THIS POSE** card.
4. Hold it until the bar fills (about half a second) to attack.
5. Keep the zombies away from MJ and survive as many waves as you can.

### Controls

| | |
|---|---|
| **Attack** | Match and hold the pose on the card. No keyboard or mouse needed. |
| **Either side** | Every pose works with either arm. |
| **Coaching** | Hints under the card tell you what to adjust ("Lean a little farther"). |
| **Sound** | Mute and volume controls in the top-right corner. |

Six poses are in play: **Side Point, Face Cover, Diagonal Reach, History Stance, Smooth Criminal Lean, Arms Overhead.** Easier poses come first; harder ones join as the waves progress.

## Features

- **Body-controlled gameplay:** real-time pose recognition from a normal webcam
- **Custom pose classifiers:** tolerant of camera distance, body size and mirroring, with live coaching
- **Zombie survival:** waves, health, score and a saved best score
- **3D arena:** a Three.js cemetery with fog and moonlight, and a rigged 3D MJ who performs every pose
- **Attack VFX:** golden charge, shockwave rings, impacts, knockback and defeat effects
- **Sound effects:** attack voice, shockwave, hits and zombie groans via the Web Audio API

| | |
|---|---|
| ![MJ charging the attack](docs/images/gold-charge.jpg) | ![Shockwave knocking zombies back](docs/images/shockwave.jpg) |

## How Pose Recognition Works

```
Webcam → MediaPipe Pose → Pose Classifier → Hold Confirmation → Attack → Zombie Knockback / Elimination
```

- **Detection:** MediaPipe Pose Landmarker tracks 33 body landmarks about 20 times per second, entirely in the browser (WebAssembly + GPU).
- **Measurements:** landmarks become body-relative values (arm direction, elbow angle, wrist height, reach, torso and leg lean) scaled to the player's torso, so the same pose reads the same near or far from the camera.
- **Classification:** each pose is a set of checks with tolerance ranges. Both arm assignments are tried, so mirrored poses count; Smooth Criminal Lean, for example, requires the whole body to lean as one line, not just a bend at the waist.
- **Confirmation:** a pose must be held for 400 ms (brief tracking dropouts are tolerated), and one confirmed pose triggers one attack.

## Privacy

The webcam video is processed locally in your browser. Nothing is recorded, saved or uploaded. The only download is the MediaPipe pose model from Google's CDN.

## Tech Stack

**TypeScript** · **Vite** · **Three.js / WebGL** · **MediaPipe Pose** (Tasks Vision) · **Web Audio API** · Node.js test runner

A static site with no backend, deployed on Vercel.

## Run Locally

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and a webcam.

```bash
git clone https://github.com/odhabit-sys/mj-thriller-pose-game.git
cd mj-thriller-pose-game
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # 249 automated tests
npm run build      # type-check + production build (dist/)
npm run preview    # serve the production build
```

During development, `/?debug=true` opens a live pose tester showing every measurement and why a pose isn't matching.

## Credits

- **3D character model:** ["Michael Jackson (Thriller)"](https://sketchfab.com/3d-models/michael-jackson-thriller-5747d705aeaf4c6fa3b3c50d01906ab8) by [MrLOCKiDY](https://sketchfab.com/MrLOCKiDY), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). Changes: the model file is unchanged; the game adds a skeleton and skin weights at load time and animates it.
- **Pose detection:** [MediaPipe](https://developers.google.com/mediapipe) by Google (Apache-2.0).
- **3D engine:** [three.js](https://threejs.org/) (MIT).
- **Pose card photos and sound clips:** Michael Jackson reference photographs, a short "hee-hee" voice clip and sound effects (including a Minecraft damage sound by Mojang Studios) belong to their respective rights holders and are used without a license for this non-commercial fan project. The "Thriller" recording is not included; the game has no background music. Full details: [docs/CREDITS.md](docs/CREDITS.md).

## Disclaimer

This is an unofficial, non-commercial fan project created for educational and entertainment purposes. Michael Jackson and related names, imagery, music, recordings, and other referenced material belong to their respective rights holders. This project is not affiliated with or endorsed by the Michael Jackson Estate or any associated rights holder. Rights holders who would like any material removed can open an issue.

## License

The original source code is released under the [MIT License](LICENSE), Copyright (c) 2026 Reda Balkhity. You're welcome to use, copy, modify and build on it.

The MIT license covers this project's own code only. It does not relicense the third-party material listed above, which keeps its own licenses and rights.
